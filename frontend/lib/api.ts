/**
 * Typed client for the NestJS RAG backend.
 *
 * Three failure modes are kept distinct on purpose, because the chat view has to
 * tell them apart:
 *   - NetworkError  : fetch() itself threw. Backend down, wrong port, CORS.
 *   - ApiError      : backend answered with 4xx/5xx. Carries class-validator's
 *                     `message` array verbatim so the UI can list it.
 *   - StreamError   : the SSE stream opened fine, then emitted {"error": "..."}.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_RAG_API ?? 'http://localhost:3000';

export type ChatRole = 'user' | 'assistant';

export interface HistoryMessage {
  role: ChatRole;
  content: string;
}

export interface Source {
  content: string;
  similarity: number;
}

export interface QueryRequest {
  question: string;
  topK?: number;
  history?: HistoryMessage[];
}

export interface QueryResponse {
  answer: string;
  sources: Source[];
}

export interface IngestResponse {
  documentId: number;
  chunksStored: number;
  chunksSkipped: number;
}

export interface DocumentSummary {
  id: number;
  /** Nullable in the database — plain-text ingests may omit a title. */
  title: string | null;
  source?: string | null;
  ingestedAt: string;
  chunkCount: number;
}

export class NetworkError extends Error {
  constructor(message = "Can't reach the RAG backend.") {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ApiError extends Error {
  readonly status: number;
  /** Always at least one entry, even when the backend sent a bare string. */
  readonly messages: string[];

  constructor(status: number, messages: string[]) {
    super(messages[0] ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.messages = messages;
  }

  get isNotFound() {
    return this.status === 404;
  }

  get isValidation() {
    return this.status === 400;
  }
}

export class StreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamError';
  }
}

/** Nest sends `message` as string[] for validation, string for everything else. */
function normalizeMessages(body: unknown, status: number): string[] {
  if (body && typeof body === 'object' && 'message' in body) {
    const raw = (body as { message: unknown }).message;
    if (Array.isArray(raw)) {
      const strings = raw.filter((m): m is string => typeof m === 'string');
      if (strings.length) return strings;
    }
    if (typeof raw === 'string' && raw.trim()) return [raw];
  }
  return [`Request failed with status ${status}.`];
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error page (proxy, crash). Fall through to the generic message.
  }
  return new ApiError(response.status, normalizeMessages(body, response.status));
}

/** Wraps fetch so a thrown TypeError becomes a NetworkError we can branch on. */
async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new NetworkError();
  }
}

async function postJson<T>(
  path: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await send(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

export function ingestText(payload: {
  text: string;
  title?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}): Promise<IngestResponse> {
  return postJson<IngestResponse>('/rag/ingest', payload);
}

export async function ingestFile(
  file: File,
  title?: string,
): Promise<IngestResponse> {
  const form = new FormData();
  form.append('file', file);
  // Only send a title when the user typed one — the backend already falls back
  // to the original filename, and an empty string would override that.
  if (title?.trim()) form.append('title', title.trim());

  const response = await send('/rag/ingest-file', { method: 'POST', body: form });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as IngestResponse;
}

export function query(
  payload: QueryRequest,
  signal?: AbortSignal,
): Promise<QueryResponse> {
  return postJson<QueryResponse>('/rag/query', payload, signal);
}

export async function listDocuments(
  signal?: AbortSignal,
): Promise<DocumentSummary[]> {
  const response = await send('/rag/documents', { method: 'GET', signal });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as DocumentSummary[];
}

export async function deleteDocument(id: number): Promise<{ deleted: boolean }> {
  const response = await send(`/rag/documents/${id}`, { method: 'DELETE' });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as { deleted: boolean };
}

/**
 * POST /rag/query-stream consumed by hand.
 *
 * EventSource is not an option here: it is GET-only and this endpoint needs a
 * JSON body, so we read the response stream and split it on the SSE record
 * separator ourselves. Records arrive as `data: {"token":"..."}\n\n`, ending in
 * either `{"done":true}` or `{"error":"..."}`.
 */
export async function streamQuery(
  payload: QueryRequest,
  options: { onToken: (token: string) => void; signal?: AbortSignal },
): Promise<void> {
  const response = await send('/rag/query-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  // Validation runs before the stream opens, so a 400 arrives as normal JSON.
  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new NetworkError('The response had no body.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;

  const handleRecord = (record: string) => {
    // A record may carry several `data:` lines; the payload is their join.
    const data = record
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('');
    if (!data) return;

    let parsed: { token?: string; done?: boolean; error?: string };
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // Ignore keep-alives or anything we don't recognise.
    }

    if (parsed.error) throw new StreamError(parsed.error);
    if (parsed.done) {
      done = true;
      return;
    }
    if (typeof parsed.token === 'string') options.onToken(parsed.token);
  };

  try {
    while (!done) {
      const { value, done: exhausted } = await reader.read();
      if (exhausted) break;
      buffer += decoder.decode(value, { stream: true });

      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const record = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        handleRecord(record);
        if (done) break;
        split = buffer.indexOf('\n\n');
      }
    }
    // Flush a trailing record that arrived without its blank-line terminator.
    if (!done && buffer.trim()) handleRecord(buffer);
  } finally {
    // Releasing the lock lets the browser tear down the connection when we
    // stop early (user hit Stop, or the stream reported an error).
    reader.cancel().catch(() => {});
  }
}
