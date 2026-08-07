import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { User } from './user.entity';

// Real bcrypt and a real JwtService, only the repository is faked. Hashing and
// signing are the two things this service exists to get right -- mocking them
// out would leave the tests asserting that AuthService calls the functions it
// obviously calls, instead of that a registered password actually verifies and
// a token actually carries the right subject.
const TEST_SECRET = 'test-secret';

interface FakeUserRepo {
  rows: User[];
  addSelectCalls: string[];
  repo: Repository<User>;
  saved: () => Partial<User>[];
}

interface FakeQueryBuilder {
  addSelect: (field: string) => FakeQueryBuilder;
  where: (clause: string, params: { email: string }) => FakeQueryBuilder;
  getOne: () => Promise<User | null>;
}

/**
 * Stand-in for the users table. It deliberately models the one subtlety of the
 * real schema: passwordHash is `select: false`, so it comes back only when a
 * caller explicitly asks for it via addSelect. A login implementation that
 * forgot that would pass against a naive mock and fail against Postgres.
 */
function createUserRepo(): FakeUserRepo {
  const rows: User[] = [];
  const addSelectCalls: string[] = [];
  const savePayloads: Partial<User>[] = [];
  let nextId = 1;

  const withoutHash = (row: User): User =>
    ({ ...row, passwordHash: undefined }) as unknown as User;

  const repo = {
    findOne: jest.fn(({ where }: { where: { email?: string } }) => {
      const row = rows.find((r) => r.email === where.email);
      return Promise.resolve(row ? withoutHash(row) : null);
    }),

    save: jest.fn((data: Partial<User>) => {
      savePayloads.push(data);
      const row: User = {
        id: nextId++,
        email: data.email!,
        passwordHash: data.passwordHash!,
        createdAt: new Date(),
      };
      rows.push(row);
      return Promise.resolve({ ...row });
    }),

    createQueryBuilder: jest.fn((): FakeQueryBuilder => {
      let selectsHash = false;
      let email: string | undefined;

      const qb: FakeQueryBuilder = {
        addSelect: (field: string) => {
          addSelectCalls.push(field);
          if (field === 'user.passwordHash') selectsHash = true;
          return qb;
        },
        where: (_clause: string, params: { email: string }) => {
          email = params.email;
          return qb;
        },
        getOne: () => {
          const row = rows.find((r) => r.email === email);
          if (!row) return Promise.resolve(null);
          return Promise.resolve(selectsHash ? { ...row } : withoutHash(row));
        },
      };
      return qb;
    }),
  } as unknown as Repository<User>;

  return { rows, addSelectCalls, repo, saved: () => savePayloads };
}

describe('AuthService', () => {
  let fake: FakeUserRepo;
  let service: AuthService;
  let jwt: JwtService;

  beforeEach(() => {
    fake = createUserRepo();
    jwt = new JwtService({
      secret: TEST_SECRET,
      signOptions: { expiresIn: '7d' },
    });
    service = new AuthService(fake.repo, jwt);
  });

  describe('register', () => {
    it('persists a bcrypt hash, never the plaintext password', async () => {
      await service.register({
        email: 'ada@example.com',
        password: 'correct-horse',
      });

      const stored = fake.rows[0];
      expect(stored.passwordHash).toBeDefined();
      expect(stored.passwordHash).not.toBe('correct-horse');
      expect(stored.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    });

    it('stores a hash that verifies against the original password', async () => {
      await service.register({
        email: 'ada@example.com',
        password: 'correct-horse',
      });

      await expect(
        bcrypt.compare('correct-horse', fake.rows[0].passwordHash),
      ).resolves.toBe(true);
      await expect(
        bcrypt.compare('wrong-horse', fake.rows[0].passwordHash),
      ).resolves.toBe(false);
    });

    it('writes no field other than the email and the hash', async () => {
      await service.register({
        email: 'ada@example.com',
        password: 'correct-horse',
      });

      const saved = fake.saved()[0];
      expect(Object.keys(saved).sort()).toEqual(['email', 'passwordHash']);
      expect(Object.values(saved)).not.toContain('correct-horse');
    });

    it('returns a token whose payload identifies the new user', async () => {
      const result = await service.register({
        email: 'ada@example.com',
        password: 'correct-horse',
      });

      const payload = jwt.verify<{ sub: number; email: string }>(
        result.accessToken,
        { secret: TEST_SECRET },
      );
      expect(payload.sub).toBe(fake.rows[0].id);
      expect(payload.email).toBe('ada@example.com');
    });

    it('returns the public user shape without the hash', async () => {
      const result = await service.register({
        email: 'ada@example.com',
        password: 'correct-horse',
      });

      expect(result.user).toEqual({ id: 1, email: 'ada@example.com' });
      expect(JSON.stringify(result)).not.toContain('$2b$');
    });

    it('rejects a duplicate email with ConflictException', async () => {
      await service.register({
        email: 'ada@example.com',
        password: 'correct-horse',
      });

      await expect(
        service.register({
          email: 'ada@example.com',
          password: 'a-different-one',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(fake.rows).toHaveLength(1);
    });

    it('issues distinct hashes for two users with the same password', async () => {
      await service.register({ email: 'a@example.com', password: 'same-pass' });
      await service.register({ email: 'b@example.com', password: 'same-pass' });

      // bcrypt salts per call; identical passwords must not be linkable by
      // comparing stored hashes.
      expect(fake.rows[0].passwordHash).not.toBe(fake.rows[1].passwordHash);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await service.register({
        email: 'ada@example.com',
        password: 'correct-horse',
      });
    });

    it('returns a token for correct credentials', async () => {
      const result = await service.login({
        email: 'ada@example.com',
        password: 'correct-horse',
      });

      const payload = jwt.verify<{ sub: number; email: string }>(
        result.accessToken,
        { secret: TEST_SECRET },
      );
      expect(payload.sub).toBe(1);
      expect(result.user).toEqual({ id: 1, email: 'ada@example.com' });
    });

    it('asks for passwordHash explicitly, since the column is select:false', async () => {
      await service.login({
        email: 'ada@example.com',
        password: 'correct-horse',
      });

      expect(fake.addSelectCalls).toContain('user.passwordHash');
    });

    it('rejects an unknown email', async () => {
      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      await expect(
        service.login({ email: 'ada@example.com', password: 'wrong-horse' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('gives the same message for both failures, so accounts cannot be enumerated', async () => {
      const unknown = await service
        .login({ email: 'nobody@example.com', password: 'whatever1' })
        .catch((e: Error) => e.message);
      const wrongPassword = await service
        .login({ email: 'ada@example.com', password: 'wrong-horse' })
        .catch((e: Error) => e.message);

      expect(unknown).toBe(wrongPassword);
    });

    it('is case-sensitive on email (documents current behaviour)', async () => {
      // Neither the service nor the users.email unique constraint normalises
      // case, so ADA@ and ada@ are different accounts. Change this test if
      // email normalisation is added.
      await expect(
        service.login({ email: 'ADA@example.com', password: 'correct-horse' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('round-trips: a registered password logs in', async () => {
    await service.register({ email: 'ada@example.com', password: 'p@ssw0rd!' });

    await expect(
      service.login({ email: 'ada@example.com', password: 'p@ssw0rd!' }),
    ).resolves.toHaveProperty('accessToken');
  });
});
