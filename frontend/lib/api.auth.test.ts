import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  NetworkError,
  deleteDocument,
  ingestText,
  listDocuments,
  login,
  query,
  register,
} from './api';
import { writeSession } from './auth-storage';

const USER = { id: 1, email: 'ada@example.com' };

function mockFetch(response: Partial<Response> & { json?: () => unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    ...response,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function headersOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const init = fetchMock.mock.calls[call][1] as RequestInit;
  return (init.headers ?? {}) as Record<string, string>;
}

describe('authenticated requests', () => {
  beforeEach(() => {
    writeSession('jwt-token', USER);
  });

  it('attaches the bearer token to a JSON POST', async () => {
    const fetchMock = mockFetch({});

    await ingestText({ text: 'hello' });

    expect(headersOf(fetchMock).Authorization).toBe('Bearer jwt-token');
  });

  it('keeps the Content-Type alongside the token', async () => {
    const fetchMock = mockFetch({});

    await query({ question: 'why?' });

    expect(headersOf(fetchMock)).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer jwt-token',
    });
  });

  it('attaches the token to GETs', async () => {
    const fetchMock = mockFetch({ json: () => Promise.resolve([]) });

    await listDocuments();

    expect(headersOf(fetchMock).Authorization).toBe('Bearer jwt-token');
  });

  it('attaches the token to DELETEs', async () => {
    const fetchMock = mockFetch({});

    await deleteDocument(3);

    expect(headersOf(fetchMock).Authorization).toBe('Bearer jwt-token');
  });

  it('reads the token per request, so a sign-out takes effect immediately', async () => {
    const fetchMock = mockFetch({ json: () => Promise.resolve([]) });

    await listDocuments();
    window.localStorage.clear();
    await listDocuments();

    expect(headersOf(fetchMock, 0).Authorization).toBe('Bearer jwt-token');
    expect(headersOf(fetchMock, 1).Authorization).toBeUndefined();
  });
});

describe('unauthenticated requests', () => {
  it('sends no Authorization header when there is no session', async () => {
    const fetchMock = mockFetch({ json: () => Promise.resolve([]) });

    await listDocuments();

    expect(headersOf(fetchMock).Authorization).toBeUndefined();
  });

  it('never sends a stale token to /auth/login', async () => {
    // A rejected token must not ride along on the request meant to replace it.
    writeSession('expired-token', USER);
    const fetchMock = mockFetch({
      json: () => Promise.resolve({ accessToken: 't', user: USER }),
    });

    await login({ email: 'ada@example.com', password: 'correct-horse' });

    expect(fetchMock.mock.calls[0][0]).toContain('/auth/login');
    expect(headersOf(fetchMock).Authorization).toBeUndefined();
  });

  it('never sends a stale token to /auth/register', async () => {
    writeSession('expired-token', USER);
    const fetchMock = mockFetch({
      json: () => Promise.resolve({ accessToken: 't', user: USER }),
    });

    await register({ email: 'ada@example.com', password: 'correct-horse' });

    expect(headersOf(fetchMock).Authorization).toBeUndefined();
  });
});

describe('auth endpoints', () => {
  it('returns the token and user from a successful login', async () => {
    mockFetch({
      json: () => Promise.resolve({ accessToken: 'fresh-token', user: USER }),
    });

    await expect(
      login({ email: 'ada@example.com', password: 'correct-horse' }),
    ).resolves.toEqual({ accessToken: 'fresh-token', user: USER });
  });

  it('posts the credentials as JSON', async () => {
    const fetchMock = mockFetch({
      json: () => Promise.resolve({ accessToken: 't', user: USER }),
    });

    await login({ email: 'ada@example.com', password: 'correct-horse' });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'ada@example.com',
      password: 'correct-horse',
    });
  });

  it('surfaces a 401 as an ApiError flagged unauthorized', async () => {
    mockFetch({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Invalid email or password' }),
    });

    const error = await login({
      email: 'ada@example.com',
      password: 'wrong',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isUnauthorized).toBe(true);
    expect((error as ApiError).messages).toEqual(['Invalid email or password']);
  });

  it("surfaces a 409 with the backend's message on a duplicate email", async () => {
    mockFetch({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({ message: 'An account with this email already exists' }),
    });

    const error = (await register({
      email: 'ada@example.com',
      password: 'correct-horse',
    }).catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(409);
    expect(error.isUnauthorized).toBe(false);
    expect(error.messages).toEqual([
      'An account with this email already exists',
    ]);
  });

  it("lists class-validator's messages verbatim on a 400", async () => {
    mockFetch({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          message: [
            'email must be an email',
            'password must be longer than or equal to 8 characters',
          ],
        }),
    });

    const error = (await register({
      email: 'nope',
      password: 'short',
    }).catch((e: unknown) => e)) as ApiError;

    expect(error.isValidation).toBe(true);
    expect(error.messages).toHaveLength(2);
  });

  it('reports a NetworkError when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));

    await expect(
      login({ email: 'ada@example.com', password: 'correct-horse' }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('expired sessions', () => {
  it('flags a 401 on a guarded route as unauthorized', async () => {
    writeSession('expired-token', USER);
    mockFetch({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    });

    const error = (await listDocuments().catch((e: unknown) => e)) as ApiError;

    expect(error.isUnauthorized).toBe(true);
  });

  it("flags a 403 as forbidden, not unauthorized -- someone else's document", async () => {
    writeSession('jwt-token', USER);
    mockFetch({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          message: "You don't have permission to delete this document",
        }),
    });

    const error = (await deleteDocument(9).catch((e: unknown) => e)) as ApiError;

    expect(error.isForbidden).toBe(true);
    expect(error.isUnauthorized).toBe(false);
  });
});
