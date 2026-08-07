import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// Auth state is module-level in localStorage, so a leaked token from one test
// silently authenticates the next one. Both stores are reset between tests.
beforeEach(() => {
  window.localStorage.clear();
  // restoreAllMocks only unwinds spies; call history on a bare vi.fn() (the
  // module mocks) would otherwise carry into the next test and make
  // "called once" assertions count earlier tests' calls.
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
