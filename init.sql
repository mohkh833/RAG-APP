-- Schema for a FRESH database. Postgres runs this only when the data volume
-- is empty (docker-entrypoint-initdb.d). Existing databases are migrated by
-- the scripts in db/migrations/ -- keep the two in sync when either changes.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  title TEXT,
  source TEXT,
  content_hash TEXT NOT NULL,
  ingested_at TIMESTAMP DEFAULT now(),
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Per user, not global: identical text ingested by two accounts is two
  -- documents, matching how IngestionService dedupes.
  UNIQUE (user_id, content_hash)
);

CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents (user_id);

CREATE TABLE IF NOT EXISTS document_chunks (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding vector(384),
  metadata JSONB,
  document_id INT REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT now(),
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS document_chunks_tsv_idx
  ON document_chunks USING gin (content_tsv);
