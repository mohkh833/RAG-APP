import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './auth-gate';
import { AuthProvider } from './auth-state';
import { ApiError, NetworkError } from '@/lib/api';

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

function renderGate() {
  return render(
    <AuthProvider>
      <AuthGate>
        <p>secret documents</p>
      </AuthGate>
    </AuthProvider>,
  );
}

function storeSession() {
  window.localStorage.setItem('verdigris.token', 'jwt-token');
  window.localStorage.setItem('verdigris.user', JSON.stringify(USER));
}

describe('AuthGate', () => {
  beforeEach(() => {
    login.mockResolvedValue(SESSION);
    register.mockResolvedValue(SESSION);
  });

  it('shows the app to a signed-in user', async () => {
    storeSession();

    renderGate();

    expect(await screen.findByText('secret documents')).toBeDefined();
  });

  it('shows the sign-in form to an anonymous visitor', async () => {
    renderGate();

    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeDefined();
    expect(screen.queryByText('secret documents')).toBeNull();
  });

});

describe('AuthView', () => {
  beforeEach(() => {
    login.mockResolvedValue(SESSION);
    register.mockResolvedValue(SESSION);
  });

  const fillIn = async (email: string, password: string) => {
    await userEvent.type(screen.getByLabelText('Email'), email);
    await userEvent.type(screen.getByLabelText('Password'), password);
  };

  it('signs in and reveals the app', async () => {
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillIn('ada@example.com', 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('secret documents')).toBeDefined();
    expect(login).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'correct-horse',
    });
  });

  it('trims a stray space off the email', async () => {
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillIn('  ada@example.com  ', 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({
        email: 'ada@example.com',
        password: 'correct-horse',
      }),
    );
  });

  it('leaves the password untouched, spaces and all', async () => {
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillIn('ada@example.com', '  spaced  ');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({
        email: 'ada@example.com',
        password: '  spaced  ',
      }),
    );
  });

  it('switches to registration and back', async () => {
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });

    await userEvent.click(
      screen.getByRole('button', { name: /Need an account/ }),
    );
    expect(
      screen.getByRole('heading', { name: 'Create an account' }),
    ).toBeDefined();

    await userEvent.click(
      screen.getByRole('button', { name: /Already have an account/ }),
    );
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeDefined();
  });

  it('registers a new account', async () => {
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });
    await userEvent.click(
      screen.getByRole('button', { name: /Need an account/ }),
    );

    await fillIn('ada@example.com', 'correct-horse');
    await userEvent.click(
      screen.getByRole('button', { name: 'Create account' }),
    );

    expect(await screen.findByText('secret documents')).toBeDefined();
    expect(register).toHaveBeenCalledOnce();
  });

  it('catches a too-short password before hitting the network', async () => {
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });
    await userEvent.click(
      screen.getByRole('button', { name: /Need an account/ }),
    );

    await fillIn('ada@example.com', 'short');
    await userEvent.click(
      screen.getByRole('button', { name: 'Create account' }),
    );

    expect(screen.getByRole('alert').textContent).toContain('at least 8');
    expect(register).not.toHaveBeenCalled();
  });

  it('does not apply the length rule to sign-in', async () => {
    // Existing accounts may predate the current policy; only the backend gets
    // to reject their password.
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillIn('ada@example.com', 'old');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(login).toHaveBeenCalledOnce());
  });

  it('shows the rejection message and keeps the form up', async () => {
    login.mockRejectedValue(new ApiError(401, ['Invalid email or password']));
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillIn('ada@example.com', 'wrong-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Invalid email or password',
    );
    expect(screen.queryByText('secret documents')).toBeNull();
  });

  it('lists every validation message from the backend', async () => {
    register.mockRejectedValue(
      new ApiError(400, [
        'email must be an email',
        'password must be longer than or equal to 8 characters',
      ]),
    );
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });
    await userEvent.click(
      screen.getByRole('button', { name: /Need an account/ }),
    );

    await fillIn('ada@example.com', 'correct-horse');
    await userEvent.click(
      screen.getByRole('button', { name: 'Create account' }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert.querySelectorAll('li')).toHaveLength(2);
  });

  it('reports an unreachable backend distinctly from bad credentials', async () => {
    login.mockRejectedValue(new NetworkError());
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillIn('ada@example.com', 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      "Can't reach the RAG backend",
    );
  });

  it('re-enables the button after a failure so the user can retry', async () => {
    login.mockRejectedValue(new ApiError(401, ['Invalid email or password']));
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillIn('ada@example.com', 'wrong-horse');
    const submit = screen.getByRole('button', { name: 'Sign in' });
    await userEvent.click(submit);
    await screen.findByRole('alert');

    expect((submit as HTMLButtonElement).disabled).toBe(false);

    login.mockResolvedValue(SESSION);
    await userEvent.click(submit);
    expect(await screen.findByText('secret documents')).toBeDefined();
  });

  it('clears a stale error when switching modes', async () => {
    login.mockRejectedValue(new ApiError(401, ['Invalid email or password']));
    renderGate();
    await screen.findByRole('heading', { name: 'Sign in' });

    await fillIn('ada@example.com', 'wrong-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('alert');

    await userEvent.click(
      screen.getByRole('button', { name: /Need an account/ }),
    );

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
