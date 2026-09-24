/**
 * Replaces (or appends) the generated UI-review section of a PR body. Pure.
 * Everything outside the markers is preserved byte for byte (CRLF included —
 * bodies edited in the GitHub UI use it), and splicing is idempotent.
 *
 * A marker only counts on a line of its own (up to three spaces of
 * indentation) outside fenced code blocks, so a description that quotes or
 * mentions the markers (`<!-- ui-review:start -->` inline, or the two-line
 * snippet in a code fence) is left alone. The first real block is the one
 * replaced.
 */

export const START_MARKER = '<!-- ui-review:start -->';
export const END_MARKER = '<!-- ui-review:end -->';

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Offsets of each marker that stands on its own line outside code fences. */
function markerLines(body: string): { marker: string; start: number; end: number }[] {
  const found: { marker: string; start: number; end: number }[] = [];
  let fence: string | null = null;
  let offset = 0;
  for (const raw of body.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const open = FENCE.exec(line);
    if (fence) {
      // A fence closes with the same character, at least as long, nothing after it.
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1]) fence = null;
    } else if (open) {
      fence = open[1];
    } else {
      const indent = line.length - line.trimStart().length;
      const text = line.trim();
      if (indent <= 3 && (text === START_MARKER || text === END_MARKER)) {
        const start = offset + indent;
        found.push({ marker: text, start, end: start + text.length });
      }
    }
    offset += raw.length + 1;
  }
  return found;
}

function findBlock(body: string): { start: number; end: number } | null {
  const markers = markerLines(body);
  const start = markers.find((m) => m.marker === START_MARKER);
  if (!start) return null;
  const end = markers.find((m) => m.marker === END_MARKER && m.start > start.start);
  if (!end) {
    // Refuse rather than guess where the section ends (and swallow the rest).
    throw new Error(
      `the PR description has a "${START_MARKER}" line without a matching "${END_MARKER}" line after it — fix the description by hand, then run again`,
    );
  }
  return { start: start.start, end: end.end };
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
