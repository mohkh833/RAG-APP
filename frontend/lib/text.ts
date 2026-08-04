/** Arabic, Hebrew, Syriac, Thaana and the Arabic supplements/presentation forms. */
const RTL_PATTERN =
  /[֐-׿؀-ۿ܀-ݏݐ-ݿހ-޿ࡠ-ࣿיִ-﷿ﹰ-ﻼ]/g;

const LTR_PATTERN = /[A-Za-zÀ-ɏ]/g;

export type Direction = 'ltr' | 'rtl';

/**
 * Picks a direction for a message from its own content, so an Arabic answer
 * lays out right-to-left while the surrounding English UI stays LTR.
 * Mixed text wins on majority: a mostly-Arabic answer quoting an English term
 * should still read as RTL.
 */
export function detectDirection(text: string): Direction {
  const rtl = text.match(RTL_PATTERN)?.length ?? 0;
  if (rtl === 0) return 'ltr';
  const ltr = text.match(LTR_PATTERN)?.length ?? 0;
  return rtl >= ltr ? 'rtl' : 'ltr';
}

/** e.g. "4 Aug 2026, 14:32" — never the raw ISO string. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Short "3h ago" label, or null when the date is old enough to not warrant one. */
export function relativeDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return null;
}

/** Similarity scores are shown to exactly 2 decimals, per the spec. */
export function formatSimilarity(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}

export function pluralize(count: number, singular: string, plural?: string) {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

export function documentTitle(doc: {
  title: string | null;
  source?: string | null;
}) {
  return doc.title?.trim() || doc.source?.trim() || 'Untitled document';
}
