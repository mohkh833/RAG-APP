'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth-state';
import { AuthView } from '@/components/auth-view';
import { Spinner } from '@/components/ui';

/**
 * Decides whether the app or the sign-in form is on screen.
 *
 * This is a UX boundary, not a security one: every /rag route is guarded by the
 * backend's JwtAuthGuard and scoped to the token's user, so bypassing this
 * component in the browser gets you an empty shell and a 401, not data.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div
        className="flex flex-1 items-center justify-center py-24 text-muted"
        role="status"
        aria-label="Loading"
      >
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (status === 'anonymous') return <AuthView />;

  return <>{children}</>;
}
