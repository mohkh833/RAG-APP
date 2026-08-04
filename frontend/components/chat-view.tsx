'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  NetworkError,
  StreamError,
  API_BASE,
  query,
  streamQuery,
  type HistoryMessage,
} from '@/lib/api';
import { detectDirection } from '@/lib/text';
import { nextTurnId, useAppState, type ChatTurn } from '@/components/app-state';
import { SourcesPanel } from '@/components/sources-panel';
import { Alert, Button, MessageList, Spinner, inputClass } from '@/components/ui';

const TOP_K_CHOICES = [3, 5, 8, 12];

export function ChatView() {
  const { turns, setTurns, clearChat } = useAppState();
  const [input, setInput] = useState('');
  const [streamMode, setStreamMode] = useState(true);
  const [topK, setTopK] = useState(5);
  const [busy, setBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Follow new tokens, but stop fighting the user if they scroll up to re-read.
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread || !stickToBottom.current) return;
    thread.scrollTop = thread.scrollHeight;
  }, [turns]);

  const onThreadScroll = () => {
    const thread = threadRef.current;
    if (!thread) return;
    const distance = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    stickToBottom.current = distance < 80;
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  // Abort an in-flight stream if the component goes away mid-answer.
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchTurn = useCallback(
    (id: string, patch: Partial<ChatTurn> | ((turn: ChatTurn) => Partial<ChatTurn>)) => {
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === id
            ? { ...turn, ...(typeof patch === 'function' ? patch(turn) : patch) }
            : turn,
        ),
      );
    },
    [setTurns],
  );

  const ask = useCallback(
    async (question: string, baseTurns: ChatTurn[], useStream: boolean) => {
      // Failed and empty turns are not part of the conversation the model saw.
      const history: HistoryMessage[] = baseTurns
        .filter((turn) => !turn.error && turn.content.trim().length > 0)
        .map(({ role, content }) => ({ role, content }));

      const userTurn: ChatTurn = {
        id: nextTurnId('user'),
        role: 'user',
        content: question,
      };
      const assistantId = nextTurnId('assistant');
      const assistantTurn: ChatTurn = {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true,
      };
      setTurns(() => [...baseTurns, userTurn, assistantTurn]);

      stickToBottom.current = true;
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;
      const payload = { question, topK, history };

      try {
        if (useStream) {
          await streamQuery(payload, {
            signal: controller.signal,
            onToken: (token) =>
              patchTurn(assistantId, (turn) => ({ content: turn.content + token })),
          });
          patchTurn(assistantId, { streaming: false });
        } else {
          const result = await query(payload, controller.signal);
          patchTurn(assistantId, {
            content: result.answer,
            sources: result.sources ?? [],
            streaming: false,
          });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          patchTurn(assistantId, (turn) => ({
            streaming: false,
            stopped: true,
            error: turn.content.trim()
              ? undefined
              : { kind: 'unknown', messages: ['Stopped before any tokens arrived.'] },
          }));
        } else if (err instanceof NetworkError) {
          patchTurn(assistantId, {
            streaming: false,
            error: {
              kind: 'network',
              messages: [
                `Could not reach the RAG backend at ${API_BASE}. Check that it is running, then retry.`,
              ],
            },
          });
        } else if (err instanceof ApiError) {
          patchTurn(assistantId, {
            streaming: false,
            error: {
              kind: err.isValidation ? 'validation' : 'unknown',
              messages: err.messages,
            },
          });
        } else if (err instanceof StreamError) {
          patchTurn(assistantId, {
            streaming: false,
            error: {
              kind: 'stream',
              messages: [err.message],
            },
          });
        } else {
          patchTurn(assistantId, {
            streaming: false,
            error: {
              kind: 'unknown',
              messages: [err instanceof Error ? err.message : 'Something went wrong.'],
            },
          });
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [patchTurn, setTurns, topK],
  );

  const submit = () => {
    const question = input.trim();
    if (!question || busy) return;
    setInput('');
    void ask(question, turns, streamMode);
  };

  /** Drops the failed exchange and re-asks with the identical history. */
  const retry = (assistantId: string) => {
    const index = turns.findIndex((turn) => turn.id === assistantId);
    if (index < 1) return;
    const question = turns[index - 1].content;
    void ask(question, turns.slice(0, index - 1), streamMode);
  };

  const empty = turns.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-medium tracking-tight text-ink">
            Ask your documents
          </h1>
          <p className="mt-1 text-sm text-muted">
            Answers are grounded in the chunks retrieved from what you have ingested.
          </p>
        </div>
        {!empty && (
          <Button variant="ghost" onClick={clearChat} disabled={busy}>
            Clear conversation
          </Button>
        )}
      </header>

      <div
        ref={threadRef}
        onScroll={onThreadScroll}
        className="min-h-0 flex-1 overflow-y-auto rounded-card border border-line bg-white px-4 py-5 sm:px-6"
      >
        {empty ? <ChatEmptyState /> : (
          <ol className="space-y-5">
            {turns.map((turn) => (
              <li key={turn.id}>
                {turn.role === 'user' ? (
                  <UserBubble turn={turn} />
                ) : (
                  <AssistantBubble turn={turn} onRetry={() => retry(turn.id)} />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-4">
        <div className="rounded-card border border-line bg-white p-3 shadow-[0_1px_2px_rgba(16,32,29,0.04)]">
          <textarea
            ref={textareaRef}
            value={input}
            dir={detectDirection(input)}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask a question — English or العربية…"
            aria-label="Your question"
            className={`${inputClass} resize-none border-0 px-1 py-1.5 text-[15px] focus:outline-none`}
          />

          <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-2.5">
            <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-muted">
              <input
                type="checkbox"
                checked={streamMode}
                onChange={(event) => setStreamMode(event.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--color-verdigris)]"
              />
              Stream tokens
            </label>

            <label className="flex items-center gap-2 text-xs font-medium text-muted">
              top K
              <select
                value={topK}
                onChange={(event) => setTopK(Number(event.target.value))}
                className="tabular rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
              >
                {TOP_K_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            </label>

            <p className="hidden text-xs text-faint sm:block">
              {streamMode
                ? 'Live tokens, no sources shown.'
                : 'Waits for the full answer, shows sources.'}
            </p>

            <div className="ms-auto flex items-center gap-2">
              {busy && (
                <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                  Stop
                </Button>
              )}
              <Button onClick={submit} disabled={busy || !input.trim()}>
                {busy ? <Spinner /> : null}
                {busy ? 'Answering' : 'Send'}
              </Button>
            </div>
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-faint">
          Enter to send · Shift + Enter for a new line
        </p>
      </div>
    </div>
  );
}

function ChatEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-verdigris-soft text-verdigris">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
          <path
            d="M4 6.5A2.5 2.5 0 0 1 6.5 4H17a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6.5A2.5 2.5 0 0 1 4 17.5v-11ZM8 9h8M8 13h5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h2 className="font-display text-lg text-ink">No questions yet</h2>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        Ask something about your ingested documents. Follow-up questions keep the
        conversation context, so &ldquo;what about the second one?&rdquo; works.
      </p>
    </div>
  );
}

function UserBubble({ turn }: { turn: ChatTurn }) {
  const direction = detectDirection(turn.content);
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-ee-md bg-verdigris px-4 py-2.5 text-[15px] leading-relaxed text-white">
        <p dir={direction} className="whitespace-pre-wrap">
          {turn.content}
        </p>
      </div>
    </div>
  );
}

function AssistantBubble({
  turn,
  onRetry,
}: {
  turn: ChatTurn;
  onRetry: () => void;
}) {
  const awaitingFirstToken = turn.streaming && !turn.content;
  const direction = detectDirection(turn.content);

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[92%]">
        <div className="rounded-2xl rounded-es-md border border-line bg-sage-50 px-4 py-3">
          {awaitingFirstToken ? (
            <ThinkingIndicator />
          ) : (
            <>
              {turn.content && (
                <p
                  dir={direction}
                  className="whitespace-pre-wrap font-display text-[15.5px] leading-[1.7] text-ink"
                >
                  {turn.content}
                  {turn.streaming && <span className="streaming-caret" />}
                </p>
              )}

              {turn.stopped && (
                <p className="mt-2 text-xs italic text-faint">Stopped by you.</p>
              )}

              {turn.error && (
                <Alert
                  tone={turn.error.kind === 'network' ? 'error' : 'warning'}
                  title={ERROR_TITLES[turn.error.kind]}
                  className={turn.content ? 'mt-3' : undefined}
                >
                  <MessageList messages={turn.error.messages} />
                  <button
                    type="button"
                    onClick={onRetry}
                    className="mt-2 rounded-md bg-white/70 px-2.5 py-1 text-xs font-semibold underline-offset-2 hover:underline"
                  >
                    Retry this question
                  </button>
                </Alert>
              )}

              {/* Streamed turns carry no sources — the endpoint does not send them. */}
              {turn.sources && !turn.error && <SourcesPanel sources={turn.sources} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const ERROR_TITLES: Record<string, string> = {
  network: 'Backend unreachable — this is a connection failure, not an answer',
  validation: 'The backend rejected this request',
  stream: 'Generation failed partway through',
  unknown: 'Request failed',
};

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-0.5 text-sm text-muted">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="thinking-dot h-1.5 w-1.5 rounded-full bg-verdigris"
            style={{ animationDelay: `${index * 0.15}s` }}
          />
        ))}
      </span>
      Retrieving chunks and generating…
    </div>
  );
}
