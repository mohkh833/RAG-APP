import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth-state';
import { ApiError } from '@/lib/api';

const { login, register } = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  login,
  register,
}));

const USER = { id: 1, email: 'ada@example.com' };
const SESSION = { accessToken: 'jwt-token', user: USER };

function Probe() {
  const { status, user, signIn, signUp, signOut } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.email ?? 'none'}</span>
      {/* signIn/signUp reject on bad credentials by design -- AuthView is what
          catches and renders that. The probe swallows it so a deliberate
          rejection does not surface as an unhandled error. */}
      <button
        onClick={() => {
          signIn({ email: 'ada@example.com', password: 'correct-horse' }).catch(
            () => {},
          );
        }}
      >
        sign in
      </button>
      <button
        onClick={() => {
          signUp({ email: 'ada@example.com', password: 'correct-horse' }).catch(
            () => {},
          );
        }}
      >
        sign up
      </button>
      <button onClick={signOut}>sign out</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

const status = () => screen.getByTestId('status').textContent;

describe('AuthProvider hydration', () => {
  beforeEach(() => {
    login.mockResolvedValue(SESSION);
    register.mockResolvedValue(SESSION);
  });

  it('settles on anonymous when nothing is stored', async () => {
    renderProbe();

    await waitFor(() => expect(status()).toBe('anonymous'));
  });

  it('restores a stored session without a network call', async () => {
    window.localStorage.setItem('verdigris.token', 'jwt-token');
    window.localStorage.setItem('verdigris.user', JSON.stringify(USER));

    renderProbe();

    await waitFor(() => expect(status()).toBe('authenticated'));
    expect(screen.getByTestId('user').textContent).toBe('ada@example.com');
    expect(login).not.toHaveBeenCalled();
  });

  it('discards a token with no matching user', async () => {
    // A half-written session cannot be presented coherently: there is no email
    // to show, and trusting the token would leave the UI in a broken state.
    window.localStorage.setItem('verdigris.token', 'jwt-token');

    renderProbe();

    await waitFor(() => expect(status()).toBe('anonymous'));
    expect(window.localStorage.getItem('verdigris.token')).toBeNull();
  });

  it('discards a user with no token', async () => {
    window.localStorage.setItem('verdigris.user', JSON.stringify(USER));

    renderProbe();

    await waitFor(() => expect(status()).toBe('anonymous'));
    expect(window.localStorage.getItem('verdigris.user')).toBeNull();
  });
});

describe('signing in and out', () => {
  beforeEach(() => {
    login.mockResolvedValue(SESSION);
    register.mockResolvedValue(SESSION);
  });

  it('persists the session on sign-in', async () => {
    renderProbe();
    await waitFor(() => expect(status()).toBe('anonymous'));

    await userEvent.click(screen.getByRole('button', { name: 'sign in' }));

    await waitFor(() => expect(status()).toBe('authenticated'));
    expect(window.localStorage.getItem('verdigris.token')).toBe('jwt-token');
    expect(JSON.parse(window.localStorage.getItem('verdigris.user')!)).toEqual(
      USER,
    );
  });

  it('persists the session on sign-up too', async () => {
    renderProbe();
    await waitFor(() => expect(status()).toBe('anonymous'));

    await userEvent.click(screen.getByRole('button', { name: 'sign up' }));

    await waitFor(() => expect(status()).toBe('authenticated'));
    expect(register).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'correct-horse',
    });
  });

  it('clears everything on sign-out', async () => {
    renderProbe();
    await userEvent.click(screen.getByRole('button', { name: 'sign in' }));
    await waitFor(() => expect(status()).toBe('authenticated'));

    await userEvent.click(screen.getByRole('button', { name: 'sign out' }));

    expect(status()).toBe('anonymous');
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(window.localStorage.length).toBe(0);
  });

  it('stays anonymous when the credentials are rejected', async () => {
    login.mockRejectedValue(new ApiError(401, ['Invalid email or password']));
    renderProbe();
    await waitFor(() => expect(status()).toBe('anonymous'));

    await userEvent.click(screen.getByRole('button', { name: 'sign in' }));

    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(status()).toBe('anonymous');
    expect(window.localStorage.length).toBe(0);
  });
});

describe('cross-tab sessions', () => {
  it('signs out when another tab clears the session', async () => {
    window.localStorage.setItem('verdigris.token', 'jwt-token');
    window.localStorage.setItem('verdigris.user', JSON.stringify(USER));
    renderProbe();
    await waitFor(() => expect(status()).toBe('authenticated'));

    // jsdom does not fire `storage` for same-document writes, which is exactly
    // how the real event behaves -- it only reaches *other* tabs.
    act(() => {
      window.localStorage.clear();
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'verdigris.token' }),
      );
    });

    await waitFor(() => expect(status()).toBe('anonymous'));
  });

  it('ignores unrelated keys written by other apps on the origin', async () => {
    window.localStorage.setItem('verdigris.token', 'jwt-token');
    window.localStorage.setItem('verdigris.user', JSON.stringify(USER));
    renderProbe();
    await waitFor(() => expect(status()).toBe('authenticated'));

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'theme' }));
    });

    expect(status()).toBe('authenticated');
  });
});

describe('useAuth', () => {
  it('fails loudly outside the provider', () => {
    // Rendering the app without <AuthProvider> would otherwise surface as an
    // undefined-property crash somewhere far from the cause.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
  });
});
