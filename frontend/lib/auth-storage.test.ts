import { describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  getServerSnapshot,
  getSnapshot,
  parseSession,
  readToken,
  readUser,
  subscribe,
  writeSession,
} from './auth-storage';

const USER = { id: 1, email: 'ada@example.com' };

describe('auth-storage', () => {
  it('round-trips a session', () => {
    writeSession('jwt-token', USER);

    expect(readToken()).toBe('jwt-token');
    expect(readUser()).toEqual(USER);
  });

  it('reads back nothing before anything is written', () => {
    expect(readToken()).toBeNull();
    expect(readUser()).toBeNull();
  });

  it('survives a reload, which is the reason for using localStorage', () => {
    writeSession('jwt-token', USER);

    // A reload is a fresh module instance reading the same backing store.
    expect(window.localStorage.getItem('verdigris.token')).toBe('jwt-token');
    expect(readToken()).toBe('jwt-token');
  });

  it('clears both halves on sign-out', () => {
    writeSession('jwt-token', USER);

    clearSession();

    expect(readToken()).toBeNull();
    expect(readUser()).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('rejects a corrupt user entry instead of returning half a session', () => {
    window.localStorage.setItem('verdigris.user', '{not json');

    expect(readUser()).toBeNull();
  });

  it('discards a user entry missing the fields the app relies on', () => {
    window.localStorage.setItem(
      'verdigris.user',
      JSON.stringify({ email: 'ada@example.com' }),
    );

    expect(readUser()).toBeNull();
  });

  it('rejects a non-numeric id rather than trusting it', () => {
    window.localStorage.setItem(
      'verdigris.user',
      JSON.stringify({ id: '1', email: 'ada@example.com' }),
    );

    expect(readUser()).toBeNull();
  });

  it('notifies subscribers on write and on clear', () => {
    // useSyncExternalStore only re-reads when told to, and the browser does not
    // fire `storage` in the tab that did the writing -- so sign-in and sign-out
    // would go unnoticed in the very tab that performed them.
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    writeSession('jwt-token', USER);
    expect(listener).toHaveBeenCalledTimes(1);

    clearSession();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    writeSession('jwt-token', USER);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('notifies subscribers when another tab writes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'verdigris.token' }),
    );

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('ignores storage events for unrelated keys', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: 'theme' }));

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('does not throw when localStorage is unavailable', () => {
    // Safari private mode and some enterprise policies make this throw on
    // access. The app should degrade to a session that does not persist.
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('access denied');
    });

    expect(() => writeSession('jwt-token', USER)).not.toThrow();
    expect(readToken()).toBeNull();
    expect(readUser()).toBeNull();
    expect(() => clearSession()).not.toThrow();
  });
});

describe('snapshots', () => {
  it('changes when the session changes and holds steady when it does not', () => {
    // React compares snapshots with Object.is; an unstable value here would
    // re-render the whole tree on every check.
    const empty = getSnapshot();
    expect(getSnapshot()).toBe(empty);

    writeSession('jwt-token', USER);
    const signedIn = getSnapshot();
    expect(signedIn).not.toBe(empty);
    expect(getSnapshot()).toBe(signedIn);

    clearSession();
    expect(getSnapshot()).toBe(empty);
  });

  it('reports the server as not-yet-known rather than signed out', () => {
    expect(getServerSnapshot()).toBeNull();
  });

  it('parses a complete session', () => {
    writeSession('jwt-token', USER);

    expect(parseSession(getSnapshot())).toEqual({
      token: 'jwt-token',
      user: USER,
    });
  });

  it('treats a token without a user as no session', () => {
    window.localStorage.setItem('verdigris.token', 'jwt-token');

    expect(parseSession(getSnapshot())).toBeNull();
  });

  it('treats a user without a token as no session', () => {
    window.localStorage.setItem('verdigris.user', JSON.stringify(USER));

    expect(parseSession(getSnapshot())).toBeNull();
  });

  it('treats a corrupt user as no session', () => {
    window.localStorage.setItem('verdigris.token', 'jwt-token');
    window.localStorage.setItem('verdigris.user', 'not json');

    expect(parseSession(getSnapshot())).toBeNull();
  });

  it('parses an empty snapshot as no session', () => {
    expect(parseSession('')).toBeNull();
  });
});
