'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import {
  ApiError,
  NetworkError,
  ingestFile,
  ingestText,
  type IngestResponse,
} from '@/lib/api';
import { useAppState } from '@/components/app-state';
import {
  Alert,
  Button,
  Card,
  Field,
  MessageList,
  PageHeader,
  Spinner,
  inputClass,
} from '@/components/ui';
import { detectDirection, pluralize } from '@/lib/text';

type Mode = 'text' | 'pdf';

export function IngestView() {
  const { documentsChanged } = useAppState();
  const [mode, setMode] = useState<Mode>('text');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setResult(null);
    setErrors(null);
  };

  const reset = () => {
    setTitle('');
    setSource('');
    setText('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleError = (err: unknown) => {
    if (err instanceof ApiError) {
      // 400s carry class-validator's array; render it as a list, never raw JSON.
      setErrors(err.messages);
    } else if (err instanceof NetworkError) {
      setErrors([`${err.message} Check that it is running, then try again.`]);
    } else {
      setErrors([err instanceof Error ? err.message : 'The ingest failed.']);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setResult(null);
    setErrors(null);

    try {
      const response =
        mode === 'text'
          ? await ingestText({
              text,
              title: title.trim() || undefined,
              source: source.trim() || undefined,
            })
          : await ingestFile(file as File, title);

      setResult(response);
      reset();
      // Tell the Documents view its list is stale.
      documentsChanged();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy && (mode === 'text' ? text.trim().length > 0 : file !== null);

  return (
    <div>
      <PageHeader
        title="Ingest"
        subtitle="Add text or a PDF. Content is chunked, embedded, and deduplicated on the way in."
      />

      <div className="mb-4 inline-flex rounded-lg border border-line bg-white p-1">
        {(
          [
            ['text', 'Paste text'],
            ['pdf', 'Upload PDF'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => switchMode(value)}
            aria-pressed={mode === value}
            className={[
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              mode === value
                ? 'bg-verdigris-soft text-verdigris-dark'
                : 'text-muted hover:text-ink',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {result && (
        <Alert tone="success" className="mb-4" title="Ingested">
          <p>
            Stored <strong className="tabular">{result.chunksStored}</strong>{' '}
            {pluralize(result.chunksStored, 'chunk')}, skipped{' '}
            <strong className="tabular">{result.chunksSkipped}</strong>{' '}
            {pluralize(result.chunksSkipped, 'duplicate')} (document #
            <span className="tabular">{result.documentId}</span>).
          </p>
          {result.chunksStored === 0 && result.chunksSkipped > 0 && (
            <p className="mt-1">
              Every chunk already existed — dedup caught the whole thing.
            </p>
          )}
          <p className="mt-1.5">
            <Link
              href="/documents"
              className="font-medium underline underline-offset-2"
            >
              View documents
            </Link>
          </p>
        </Alert>
      )}

      {errors && (
        <Alert tone="error" className="mb-4" title="The backend rejected this">
          <MessageList messages={errors} />
        </Alert>
      )}

      <Card className="p-5">
        <form onSubmit={submit} className="space-y-5">
          {mode === 'text' ? (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Title" htmlFor="title" hint="Optional.">
                  <input
                    id="title"
                    value={title}
                    dir={detectDirection(title)}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Q3 support policy"
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Source"
                  htmlFor="source"
                  hint="Optional — where this came from."
                >
                  <input
                    id="source"
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                    placeholder="notion://policies/q3"
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field
                label="Text"
                htmlFor="text"
                hint={`${text.length.toLocaleString()} characters`}
              >
                <textarea
                  id="text"
                  value={text}
                  dir={detectDirection(text)}
                  onChange={(event) => setText(event.target.value)}
                  rows={12}
                  placeholder="Paste the document text here…"
                  className={`${inputClass} resize-y leading-relaxed`}
                />
              </Field>
            </>
          ) : (
            <>
              <Field
                label="PDF file"
                htmlFor="file"
                hint="Text-based PDFs only — scans without OCR have no extractable text. Max 20 MB."
              >
                <input
                  ref={fileInputRef}
                  id="file"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setResult(null);
                    setErrors(null);
                  }}
                  className="block w-full cursor-pointer rounded-lg border border-dashed border-line-strong bg-sage-50 px-3 py-6 text-sm text-muted file:me-3 file:rounded-md file:border-0 file:bg-verdigris file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:border-verdigris-ring"
                />
              </Field>

              {file && (
                <p className="text-xs text-muted">
                  Selected <span className="font-medium text-ink">{file.name}</span>{' '}
                  <span className="tabular text-faint">
                    ({(file.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                </p>
              )}

              <Field
                label="Title"
                htmlFor="pdf-title"
                hint={
                  file
                    ? `Optional — defaults to “${file.name}”.`
                    : 'Optional — defaults to the filename.'
                }
              >
                <input
                  id="pdf-title"
                  value={title}
                  dir={detectDirection(title)}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={file?.name ?? 'Employee handbook'}
                  className={inputClass}
                />
              </Field>
            </>
          )}

          <div className="flex items-center gap-3 border-t border-line pt-4">
            <Button type="submit" disabled={!canSubmit}>
              {busy ? <Spinner /> : null}
              {busy ? 'Ingesting…' : mode === 'text' ? 'Ingest text' : 'Ingest PDF'}
            </Button>
            <p className="text-xs text-faint">
              {busy
                ? 'Chunking and embedding — larger documents take a moment.'
                : 'Re-ingesting the same content will show up as skipped duplicates.'}
            </p>
          </div>
        </form>
      </Card>
    </div>
  );
}
