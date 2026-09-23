/**
 * Replaces (or appends) the generated UI-review section of a PR body. Pure.
 * Everything outside the markers is preserved byte for byte (CRLF included —
 * bodies edited in the GitHub UI use it), and splicing is idempotent.
 */

export const START_MARKER = '<!-- ui-review:start -->';
export const END_MARKER = '<!-- ui-review:end -->';

function findBlock(body: string): { start: number; end: number } | null {
  const start = body.indexOf(START_MARKER);
  if (start === -1) return null;
  const endMarker = body.indexOf(END_MARKER, start + START_MARKER.length);
  // No end marker: the block was truncated (e.g. hand-edited) — it runs to the end.
  const end = endMarker === -1 ? body.length : endMarker + END_MARKER.length;
  return { start, end };
}

export function spliceBlock(body: string, block: string): string {
  if (!block.startsWith(START_MARKER) || !block.trimEnd().endsWith(END_MARKER)) {
    throw new Error(`block must start with ${START_MARKER} and end with ${END_MARKER} markers`);
  }
  const clean = block.trimEnd();
  const found = findBlock(body);
  if (found) return body.slice(0, found.start) + clean + body.slice(found.end);
  if (body.trim() === '') return `${clean}\n`;
  const separator = body.endsWith('\n\n') || body.endsWith('\r\n\r\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n';
  return `${body}${separator}${clean}\n`;
}

export function extractBlock(body: string): string | null {
  const found = findBlock(body);
  return found ? body.slice(found.start, found.end) : null;
}
