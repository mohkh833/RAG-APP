'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ApiError,
  NetworkError,
  deleteDocument,
  listDocuments,
  type DocumentSummary,
} from '@/lib/api';
import { useAppState } from '@/components/app-state';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  MessageList,
  PageHeader,
  Spinner,
} from '@/components/ui';
import {
  detectDirection,
  documentTitle,
  formatDate,
  pluralize,
  relativeDate,
} from '@/lib/text';

type Notice = { tone: 'success' | 'warning' | 'error'; messages: string[] } | null;

export function DocumentsView() {
  const { documentsVersion, documentsChanged } = useAppState();
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Refetches on mount, on manual refresh, and whenever an ingest elsewhere in
  // the app bumps documentsVersion.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    listDocuments(controller.signal)
      .then((result) => {
        if (!active) return;
        setDocuments(result);
        setLoadError(null);
      })
      .catch((err) => {
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return;
        setDocuments([]);
        setLoadError(
          err instanceof ApiError
            ? err.messages
            : [
                err instanceof NetworkError
                  ? err.message + ' Is it running on port 3000?'
                  : 'Could not load the document list.',
              ],
        );
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [documentsVersion, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  const confirmDelete = async (doc: DocumentSummary) => {
    setDeletingId(doc.id);
    setNotice(null);
    const title = documentTitle(doc);
    try {
      await deleteDocument(doc.id);
      setNotice({ tone: 'success', messages: [`Deleted “${title}”.`] });
    } catch (err) {
      if (err instanceof ApiError && err.isNotFound) {
        // Already gone — someone deleted it elsewhere. Not a crash, just stale UI.
        setNotice({
          tone: 'warning',
          messages: [`“${title}” was already deleted. The list has been refreshed.`],
        });
      } else if (err instanceof ApiError) {
        setNotice({ tone: 'error', messages: err.messages });
      } else if (err instanceof NetworkError) {
        setNotice({ tone: 'error', messages: [err.message] });
      } else {
        setNotice({ tone: 'error', messages: ['Could not delete that document.'] });
      }
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
      // Either way the server is the source of truth, so resync.
      documentsChanged();
    }
  };

  const loading = documents === null;
  const totalChunks = documents?.reduce((sum, doc) => sum + doc.chunkCount, 0) ?? 0;

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle={
          loading || !documents?.length
            ? 'Everything currently in the vector store.'
            : `${documents.length} ${pluralize(documents.length, 'document')} · ${totalChunks} ${pluralize(totalChunks, 'chunk')} indexed`
        }
        action={
          <Button variant="secondary" onClick={refresh} disabled={loading}>
            {loading ? <Spinner /> : null}
            Refresh
          </Button>
        }
      />

      {notice && (
        <Alert tone={notice.tone} className="mb-4">
          <MessageList messages={notice.messages} />
        </Alert>
      )}

      {loadError && (
        <Alert tone="error" title="Could not load documents" className="mb-4">
          <MessageList messages={loadError} />
        </Alert>
      )}

      {loading ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Spinner />
            Loading documents…
          </div>
        </Card>
      ) : documents.length === 0 && !loadError ? (
        <Card>
          <EmptyState
            title="Nothing ingested yet"
            icon={
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                <path
                  d="M7 3.5h6.5L18 8v12.5H7V3.5Zm6 0V8h5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
              </svg>
            }
          >
            The vector store is empty, so questions have nothing to retrieve from.
            Head to{' '}
            <Link
              href="/ingest"
              className="font-medium text-verdigris underline underline-offset-2"
            >
              Ingest
            </Link>{' '}
            to add some text or upload a PDF.
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-2.5">
          {documents.map((doc) => {
            const title = documentTitle(doc);
            const relative = relativeDate(doc.ingestedAt);
            const confirming = confirmingId === doc.id;
            const deleting = deletingId === doc.id;

            return (
              <li key={doc.id}>
                <Card className="flex flex-wrap items-center gap-4 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <h2
                      dir={detectDirection(title)}
                      className="truncate font-display text-[17px] text-ink"
                      title={title}
                    >
                      {title}
                    </h2>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                      <span className="tabular">{formatDate(doc.ingestedAt)}</span>
                      {relative && <span className="text-faint">({relative})</span>}
                      <span aria-hidden="true" className="text-line-strong">
                        ·
                      </span>
                      <span className="tabular">
                        {doc.chunkCount} {pluralize(doc.chunkCount, 'chunk')}
                      </span>
                      <span aria-hidden="true" className="text-line-strong">
                        ·
                      </span>
                      <span className="tabular text-faint">#{doc.id}</span>
                    </p>
                  </div>

                  {confirming ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-brick">
                        Delete this and its chunks?
                      </span>
                      <Button
                        variant="danger"
                        onClick={() => confirmDelete(doc)}
                        disabled={deleting}
                      >
                        {deleting ? <Spinner /> : null}
                        {deleting ? 'Deleting' : 'Yes, delete'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setConfirmingId(null)}
                        disabled={deleting}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setNotice(null);
                        setConfirmingId(doc.id);
                      }}
                      className="text-brick"
                    >
                      Delete
                    </Button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
