/**
 * Flattens message spans into a single searchable text string.
 * Extracts text from all spans and joins them with spaces.
 * Returns lowercase for case-insensitive search indexing.
 */
export function flattenSpansToText(
  spans: { text?: string | null }[],
): string | undefined {
  const text = spans
    .filter((span) => span.text)
    .map((span) => span.text)
    .join(' ')
    .trim()
    .toLowerCase();
  return text.length > 0 ? text : undefined;
}

/** Bidi embeddings, overrides, isolates and marks: they reorder what is drawn. */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;

/**
 * Flattens message spans into a single display text string.
 * Same as flattenSpansToText but preserves original case for display purposes
 * (e.g. push notification bodies).
 */
export function flattenSpansToDisplayText(
  spans: { text?: string | null }[],
): string | undefined {
  const text = spans
    .filter((span) => span.text)
    .map((span) => span.text)
    .join(' ')
    .replace(BIDI_CONTROLS, '')
    .trim();
  return text.length > 0 ? text : undefined;
}
