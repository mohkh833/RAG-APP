'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ChatRole, Source } from '@/lib/api';

export type ErrorKind = 'network' | 'validation' | 'stream' | 'unknown';

export interface ChatTurn {
  id: string;
  role: ChatRole;
  content: string;
  /** True while tokens are still arriving from the SSE stream. */
  streaming?: boolean;
  /** Only present on non-streamed answers — /rag/query-stream sends no sources. */
  sources?: Source[];
  /** Set instead of content when the turn failed. */
  error?: { kind: ErrorKind; messages: string[] };
  /** The user hit Stop mid-stream; whatever arrived is kept. */
  stopped?: boolean;
}

let turnCounter = 0;
export function nextTurnId(prefix: string) {
  turnCounter += 1;
  return `${prefix}-${turnCounter}`;
}

interface AppState {
  turns: ChatTurn[];
  setTurns: (update: (turns: ChatTurn[]) => ChatTurn[]) => void;
  clearChat: () => void;
  /** Bumped whenever an ingest succeeds, so the Documents view refetches. */
  documentsVersion: number;
  documentsChanged: () => void;
}

const AppStateContext = createContext<AppState | null>(null);

/**
 * Chat history and the documents-changed signal live above the router so that
 * navigating Chat → Ingest → Chat keeps the conversation, and an ingest done on
 * one page invalidates the document list on another. A page refresh still
 * resets everything, which is the intended scope.
 */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [turns, setTurnsState] = useState<ChatTurn[]>([]);
  const [documentsVersion, setDocumentsVersion] = useState(0);

  const setTurns = useCallback(
    (update: (turns: ChatTurn[]) => ChatTurn[]) => setTurnsState(update),
    [],
  );
  const clearChat = useCallback(() => setTurnsState([]), []);
  const documentsChanged = useCallback(
    () => setDocumentsVersion((version) => version + 1),
    [],
  );

  const value = useMemo(
    () => ({ turns, setTurns, clearChat, documentsVersion, documentsChanged }),
    [turns, setTurns, clearChat, documentsVersion, documentsChanged],
  );

  return (
    <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used inside <AppStateProvider>');
  }
  return context;
}
