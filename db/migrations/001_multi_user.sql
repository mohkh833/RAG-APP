-- 001_multi_user.sql
--
-- Adds per-user ownership to an EXISTING ragdb.
--
-- init.sql only runs on a fresh Postgres volume (docker-entrypoint-initdb.d),
-- so any database that already has documents in it needs this script instead.
-- Fresh installs get the same end state directly from init.sql -- keep the two
-- in sync when either changes.
--
--   docker compose exec -T postgres psql -U postgres -d ragdb < db/migrations/001_multi_user.sql
--
-- Idempotent: safe to run more than once. Runs in a single transaction, so a
-- failure (e.g. the orphan check below) leaves the schema untouched.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
--
-- Committed on its own, ahead of the rest. The ownership step below aborts if
-- it finds documents but no account to hand them to, and its advice is to go
-- register one -- which is only possible if this table outlives that rollback.

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);

COMMIT;

BEGIN;

-- ---------------------------------------------------------------------------
-- documents.user_id
-- ---------------------------------------------------------------------------

-- Added nullable so existing rows survive the ALTER; backfilled and made
-- NOT NULL further down.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id INT;

-- Pre-existing documents have no owner. Assign them to the oldest account --
-- on a single-user dev database that is the only account, which is the case
-- this branch is actually migrating. If documents exist and no account does,
-- there is no defensible owner to pick, so stop and let a human decide.
DO $$
DECLARE
  orphans  BIGINT;
  owner_id INT;
BEGIN
  SELECT count(*) INTO orphans FROM documents WHERE user_id IS NULL;
  IF orphans = 0 THEN
    RETURN;
  END IF;

  SELECT id INTO owner_id FROM users ORDER BY id LIMIT 1;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION
      '% document(s) have no owner and no user accounts exist. Register an account first (POST /auth/register), then re-run this migration -- or delete the orphaned documents if they are disposable test data.',
      orphans;
  END IF;

  UPDATE documents SET user_id = owner_id WHERE user_id IS NULL;
  RAISE NOTICE 'Assigned % orphaned document(s) to user %', orphans, owner_id;
END $$;

ALTER TABLE documents ALTER COLUMN user_id SET NOT NULL;

-- Deleting an account takes its documents with it, and document_chunks
-- already cascades from documents.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_user_id_fkey'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Every retrieval and listing query filters on user_id.
CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents (user_id);

-- ---------------------------------------------------------------------------
-- content_hash uniqueness: global -> per user
-- ---------------------------------------------------------------------------
--
-- The old global UNIQUE(content_hash) means the second user to ingest a given
-- text hits a unique violation instead of getting their own copy. Ingestion
-- dedupes per owner (IngestionService.findIngested matches contentHash AND
-- userId), so the constraint has to match that: identical text is one document
-- per user, not one document overall.

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_content_hash_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_user_id_content_hash_key'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_user_id_content_hash_key
      UNIQUE (user_id, content_hash);
  END IF;
END $$;

COMMIT;
