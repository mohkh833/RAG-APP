import { ChunkingService } from '../chunking/chunking.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { hashContent, IngestionService } from './ingestion.service';

// Pure function, no DI — imported and called directly, no testing module.
describe('hashContent', () => {
  it('is deterministic for the same input', () => {
    expect(hashContent('the titanic sank in 1912')).toBe(
      hashContent('the titanic sank in 1912'),
    );
  });

  it('is stable across many calls (no salt or randomness)', () => {
    const hashes = new Set(
      Array.from({ length: 50 }, () => hashContent('same content')),
    );
    expect(hashes.size).toBe(1);
  });

  it('produces different hashes for different inputs', () => {
    expect(hashContent('chunk a')).not.toBe(hashContent('chunk b'));
  });

  it('is sensitive to small differences', () => {
    const inputs = ['titanic', 'Titanic', 'titanic ', ' titanic', 'titanlc'];
    const hashes = new Set(inputs.map(hashContent));
    expect(hashes.size).toBe(inputs.length);
  });

  it('returns a 64-char lowercase hex sha256 digest', () => {
    expect(hashContent('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the known sha256 of an empty string', () => {
    expect(hashContent('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes identical Arabic content identically', () => {
    expect(hashContent('غرقت السفينة تيتانيك')).toBe(
      hashContent('غرقت السفينة تيتانيك'),
    );
    expect(hashContent('غرقت السفينة تيتانيك')).not.toBe(
      hashContent('غرقت السفينة'),
    );
  });
});

// ---------------------------------------------------------------------------
// ingestText — ownership
// ---------------------------------------------------------------------------
//
// Everything below covers the multi-user contract: a document belongs to the
// caller, and dedupe is scoped to that owner. The old single-user behaviour
// (one document per content_hash globally) would silently hand user B a
// document owned by user A, which B could then never retrieve.

interface StoredDocument {
  id: number;
  title: string;
  source?: string;
  contentHash: string;
  userId: number;
}

function createIngestionHarness() {
  const documents: StoredDocument[] = [];
  const chunkRows: { documentId: number; content: string }[] = [];
  let nextDocumentId = 1;

  const chunking = {
    chunk: jest.fn((text: string) => text.split('|')),
  } as unknown as ChunkingService;

  const embed = jest.fn(() => Promise.resolve([0.1, 0.2, 0.3]));
  const embedding = { embed } as unknown as EmbeddingService;

  // Stands in for the UNIQUE (user_id, content_hash) constraint the migration
  // installs, so the service's duplicate handling is exercised against the
  // same rule Postgres enforces.
  const saveDocument = (data: Omit<StoredDocument, 'id'>) => {
    const clash = documents.find(
      (d) => d.userId === data.userId && d.contentHash === data.contentHash,
    );
    if (clash) {
      // Shaped like TypeORM's QueryFailedError: the service reaches through
      // .driverError.code to recognise a unique violation.
      const error = Object.assign(
        new Error('duplicate key value violates unique constraint'),
        { driverError: { code: '23505' } },
      );
      return Promise.reject(error);
    }
    const row = { ...data, id: nextDocumentId++ };
    documents.push(row);
    return Promise.resolve(row);
  };

  const manager = {
    getRepository: () => ({ save: saveDocument }),
    query: jest.fn((_sql: string, params: unknown[]) => {
      chunkRows.push({
        documentId: params[3] as number,
        content: params[0] as string,
      });
      return Promise.resolve();
    }),
  };

  const documentRepo = {
    manager: {
      transaction: jest.fn((work: (m: typeof manager) => Promise<number>) =>
        work(manager),
      ),
    },
    findOne: jest.fn(
      ({ where }: { where: { contentHash: string; userId: number } }) =>
        Promise.resolve(
          documents.find(
            (d) =>
              d.contentHash === where.contentHash && d.userId === where.userId,
          ) ?? null,
        ),
    ),
  };

  const chunkRepo = {
    count: jest.fn(({ where }: { where: { documentId: number } }) =>
      Promise.resolve(
        chunkRows.filter((c) => c.documentId === where.documentId).length,
      ),
    ),
  };

  const service = new IngestionService(
    chunking,
    embedding,
    chunkRepo as never,
    documentRepo as never,
  );

  return { service, documents, chunkRows, embed, documentRepo };
}

describe('IngestionService.ingestText', () => {
  const ALICE = 1;
  const BOB = 2;

  let harness: ReturnType<typeof createIngestionHarness>;

  beforeEach(() => {
    harness = createIngestionHarness();
  });

  it('stamps the caller as the owner of the new document', async () => {
    await harness.service.ingestText('a|b', ALICE, { title: 'Notes' });

    expect(harness.documents).toHaveLength(1);
    expect(harness.documents[0].userId).toBe(ALICE);
  });

  it('gives each user their own document for identical text', async () => {
    const alice = await harness.service.ingestText('shared text', ALICE);
    const bob = await harness.service.ingestText('shared text', BOB);

    expect(bob.documentId).not.toBe(alice.documentId);
    expect(harness.documents.map((d) => d.userId)).toEqual([ALICE, BOB]);
    expect(bob.chunksStored).toBe(1);
  });

  it('dedupes a re-ingest by the same user', async () => {
    const first = await harness.service.ingestText('shared text', ALICE);
    const second = await harness.service.ingestText('shared text', ALICE);

    expect(second.documentId).toBe(first.documentId);
    expect(second.chunksStored).toBe(0);
    expect(harness.documents).toHaveLength(1);
  });

  it("never returns another user's document from the dedupe path", async () => {
    await harness.service.ingestText('shared text', ALICE);
    const bob = await harness.service.ingestText('shared text', BOB);

    const returned = harness.documents.find((d) => d.id === bob.documentId);
    expect(returned?.userId).toBe(BOB);
  });

  it('scopes the dedupe lookup by userId, not by hash alone', async () => {
    await harness.service.ingestText('shared text', ALICE);

    expect(harness.documentRepo.findOne).toHaveBeenCalledWith({
      where: { contentHash: hashContent('shared text'), userId: ALICE },
    });
  });

  it('recovers from a concurrent duplicate insert by the same user', async () => {
    // Two requests racing past the dedupe check: the loser hits the unique
    // constraint and must resolve to the winner's document rather than 500.
    const [first, second] = await Promise.all([
      harness.service.ingestText('racy text', ALICE),
      harness.service.ingestText('racy text', ALICE),
    ]);

    expect(harness.documents).toHaveLength(1);
    expect(second.documentId).toBe(first.documentId);
  });

  it('skips duplicate chunks within one document', async () => {
    const result = await harness.service.ingestText('same|same|other', ALICE);

    expect(result.chunksStored).toBe(2);
    expect(result.chunksSkipped).toBe(1);
  });

  it('embeds a title-prefixed chunk but stores the original text', async () => {
    await harness.service.ingestText('the ship sank', ALICE, {
      title: 'Titanic',
    });

    expect(harness.embed).toHaveBeenCalledWith(
      'Document: Titanic\nthe ship sank',
    );
    expect(harness.chunkRows[0].content).toBe('the ship sank');
  });
});
