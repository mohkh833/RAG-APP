import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthGate } from './auth-gate';

/**
 * The three states of the gate, driven directly.
 *
 * `loading` cannot be observed through the real provider: Testing Library's
 * render flushes effects before returning, so the hydration effect has already
 * resolved the session by the time an assertion runs. Mocking useAuth is what
 * makes the pre-hydration frame -- the one a real browser actually paints --
 * reachable from a test.
 */
const useAuth = vi.hoisted(() => vi.fn());

vi.mock('./auth-state', () => ({ useAuth }));

function renderWithStatus(status: 'loading' | 'anonymous' | 'authenticated') {
  useAuth.mockReturnValue({
    status,
    user: status === 'authenticated' ? { id: 1, email: 'ada@example.com' } : null,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  });

  return render(
    <AuthGate>
      <p>secret documents</p>
    </AuthGate>,
  );
}

describe('AuthGate states', () => {
  it('shows neither the app nor the form while hydrating', () => {
    renderWithStatus('loading');

    // A signed-in user must not see the sign-in form flash on first paint.
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByText('secret documents')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeDefined();
  });

  it('shows the form when anonymous', () => {
    renderWithStatus('anonymous');

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeDefined();
    expect(screen.queryByText('secret documents')).toBeNull();
  });

  it('shows the app when authenticated', () => {
    renderWithStatus('authenticated');

    expect(screen.getByText('secret documents')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
  });
});
