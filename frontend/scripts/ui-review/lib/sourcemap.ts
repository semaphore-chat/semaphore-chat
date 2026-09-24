/**
 * Just enough source-map support to map a V8 function range in Vite's
 * transformed module back to lines of the original file: base64-VLQ decoding
 * of `mappings` plus the inline `sourceMappingURL=data:` map Vite's dev server
 * appends to every module. Pure.
 */

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_INDEX = new Map([...BASE64].map((ch, i) => [ch, i]));

/** One decoded mapping segment (all 0-based). */
export interface Segment {
  genLine: number;
  genCol: number;
  sourceIndex: number;
  origLine: number;
  origCol: number;
}

/** Decodes a source map `mappings` string (segments without a source are skipped). */
export function decodeMappings(mappings: string): Segment[] {
  const out: Segment[] = [];
  let sourceIndex = 0;
  let origLine = 0;
  let origCol = 0;
  const lines = mappings.split(';');
  for (let genLine = 0; genLine < lines.length; genLine++) {
    let genCol = 0;
    if (!lines[genLine]) continue;
    for (const segment of lines[genLine].split(',')) {
      if (!segment) continue;
      const values = decodeVlq(segment);
      genCol += values[0];
      if (values.length >= 4) {
        sourceIndex += values[1];
        origLine += values[2];
        origCol += values[3];
        out.push({ genLine, genCol, sourceIndex, origLine, origCol });
      }
    }
  }
  return out;
}

function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = BASE64_INDEX.get(ch);
    if (digit === undefined) throw new Error(`invalid VLQ character "${ch}"`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

export interface InlineSourceMap {
  sources: string[];
  segments: Segment[];
}

/** Reads the last inline `//# sourceMappingURL=data:application/json;base64,...` of a module. */
export function readInlineSourceMap(source: string): InlineSourceMap | null {
  const marker = 'sourceMappingURL=data:application/json;';
  const at = source.lastIndexOf(marker);
  if (at === -1) return null;
  const rest = source.slice(at + marker.length);
  const comma = rest.indexOf(',');
  if (comma === -1) return null;
  const encoding = rest.slice(0, comma);
  const payload = rest.slice(comma + 1).split(/\s/)[0];
  let json: string;
  try {
    json = encoding.includes('base64') ? decodeBase64(payload) : decodeURIComponent(payload);
  } catch {
    return null;
  }
  try {
    const map = JSON.parse(json) as { sources?: string[]; mappings?: string };
    return { sources: map.sources ?? [], segments: decodeMappings(map.mappings ?? '') };
  } catch {
    return null;
  }
}

function decodeBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 0-based offsets where each generated line starts. */
export function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** Offset → {line, col} (0-based) in the generated source. */
export function positionAt(starts: number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, col: offset - starts[lo] };
}

/**
 * Original (1-based) line span covered by a generated offset range, from the
 * mapping segments that fall inside it; null when nothing maps there.
 */
export function originalLineSpan(
  segments: Segment[],
  starts: number[],
  startOffset: number,
  endOffset: number,
  sourceIndex = 0,
): { from: number; to: number } | null {
  const start = positionAt(starts, startOffset);
  const end = positionAt(starts, endOffset);
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const seg of segments) {
    if (seg.sourceIndex !== sourceIndex) continue;
    const afterStart = seg.genLine > start.line || (seg.genLine === start.line && seg.genCol >= start.col);
    const beforeEnd = seg.genLine < end.line || (seg.genLine === end.line && seg.genCol < end.col);
    if (!afterStart || !beforeEnd) continue;
    from = Math.min(from, seg.origLine + 1);
    to = Math.max(to, seg.origLine + 1);
  }
  return from === Number.POSITIVE_INFINITY ? null : { from, to };
}
