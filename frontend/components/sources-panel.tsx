'use client';

import { useState } from 'react';
import type { Source } from '@/lib/api';
import { detectDirection, formatSimilarity, pluralize } from '@/lib/text';

/**
 * Collapsible list of the chunks that were retrieved for an answer. Only shown
 * for non-streamed turns — /rag/query-stream emits tokens and a done flag, never
 * sources, so a streamed turn genuinely has none to show.
 */
export function SourcesPanel({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);

  if (!sources.length) {
    return (
      <p className="mt-3 text-xs text-faint">
        No sources were returned for this answer.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-semibold uppercase tracking-wide text-verdigris transition-colors hover:bg-verdigris-soft"
      >
        <svg
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {sources.length} {pluralize(sources.length, 'source')}
      </button>

      {open && (
        <ol className="mt-2 space-y-2">
          {sources.map((source, index) => {
            const direction = detectDirection(source.content);
            return (
              <li
                key={index}
                className="rounded-lg border border-line bg-sage-50 px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-wide text-faint">
                  <span>Chunk {index + 1}</span>
                  <span
                    className="tabular rounded-full bg-white px-2 py-0.5 text-verdigris-dark ring-1 ring-verdigris-ring"
                    title="Cosine similarity to the question"
                  >
                    {formatSimilarity(source.similarity)}
                  </span>
                </div>
                <p
                  dir={direction}
                  className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft"
                >
                  {source.content}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
