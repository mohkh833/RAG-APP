'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import * as api from '@/lib/api';
import {
  clearSession,
  getServerSnapshot,
  getSnapshot,
  parseSession,
  subscribe,
  writeSession,
} from '@/lib/auth-storage';
import type { AuthUser } from '@/lib/auth-storage';

/**
 * `loading` is the pre-hydration state, not a spinner for a network call.
 * The server renders without access to localStorage, so the first client render
 * must match it — the stored session only becomes readable once React swaps to
 * the client snapshot. Rendering the sign-in form during that frame would flash
 * it at users who are already signed in.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (credentials: api.Credentials) => Promise<void>;
  signUp: (credentials: api.Credentials) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // localStorage is an external store, so React subscribes to it rather than
  // mirroring it into state. That keeps this tab, other tabs, and the API
  // client all reading one source of truth.
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const session = useMemo(
    () => (snapshot === null ? null : parseSession(snapshot)),
    [snapshot],
  );

  const status: AuthStatus =
    snapshot === null ? 'loading' : session ? 'authenticated' : 'anonymous';

  // A half-written session (one key without the other, or a corrupt user
  // entry) is already treated as signed out; this scrubs the leftovers so the
  // next read is clean. Clearing storage is an external-system write, not a
  // setState, so it belongs in an effect.
  useEffect(() => {
    if (snapshot && !session) clearSession();
  }, [snapshot, session]);

  const signIn = useCallback(async (credentials: api.Credentials) => {
    const result = await api.login(credentials);
    writeSession(result.accessToken, result.user);
  }, []);

  const signUp = useCallback(async (credentials: api.Credentials) => {
    const result = await api.register(credentials);
    writeSession(result.accessToken, result.user);
  }, []);

  const signOut = useCallback(() => clearSession(), []);

  const value = useMemo(
    () => ({ status, user: session?.user ?? null, signIn, signUp, signOut }),
    [status, session, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
