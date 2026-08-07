import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentService } from './document.service';
import type { DeleteResult } from 'typeorm';
import type { Document } from '../document.entity';

// Ownership enforcement: authentication establishes who the caller is, this is
// where that identity is actually checked against the data.

function createHarness(rows: Partial<Document>[]) {
  const deleted: unknown[] = [];

  const repo = {
    findOne: jest.fn(({ where }: { where: { id: number } }) =>
      Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
    ),
    delete: jest.fn((criteria: unknown): Promise<DeleteResult> => {
      deleted.push(criteria);
      return Promise.resolve({ affected: 1, raw: [] });
    }),
    query: jest.fn<Promise<unknown[]>, [string, unknown[]?]>(() =>
      Promise.resolve([]),
    ),
  };

  return { service: new DocumentService(repo as never), repo, deleted };
}

const ALICE = 1;
const BOB = 2;

describe('DocumentService.list', () => {
  it('filters by the calling user', async () => {
    const { service, repo } = createHarness([]);

    await service.list(ALICE);

    const [sql, params] = repo.query.mock.calls[0];
    expect(sql).toContain('d.user_id = $1');
    expect(params).toEqual([ALICE]);
  });
});

describe('DocumentService.delete', () => {
  it('deletes a document the caller owns', async () => {
    const { service, repo } = createHarness([{ id: 10, userId: ALICE }]);

    await expect(service.delete(10, ALICE)).resolves.toEqual({ deleted: true });
    expect(repo.delete).toHaveBeenCalled();
  });

  it('refuses to delete a document owned by someone else', async () => {
    const { service, repo } = createHarness([{ id: 10, userId: ALICE }]);

    await expect(service.delete(10, BOB)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('throws NotFound for a document that does not exist', async () => {
    const { service } = createHarness([]);

    await expect(service.delete(999, ALICE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports deleted:false when the row vanished mid-request', async () => {
    const { service, repo } = createHarness([{ id: 10, userId: ALICE }]);
    repo.delete.mockResolvedValue({ affected: 0, raw: [] });

    await expect(service.delete(10, ALICE)).resolves.toEqual({
      deleted: false,
    });
  });

  it('tolerates a driver that does not report affected rows', async () => {
    // DeleteResult.affected is number | null | undefined -- not every driver
    // fills it in. A null must not become a truthy comparison.
    const { service, repo } = createHarness([{ id: 10, userId: ALICE }]);
    repo.delete.mockResolvedValue({ affected: null, raw: [] });

    await expect(service.delete(10, ALICE)).resolves.toEqual({
      deleted: false,
    });
  });
});
