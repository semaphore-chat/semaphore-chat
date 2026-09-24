// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  decodeMappings,
  readInlineSourceMap,
  lineStarts,
  positionAt,
  originalLineSpan,
} from '../../../../scripts/ui-review/lib/sourcemap.ts';

describe('decodeMappings', () => {
  it('decodes relative VLQ segments across lines', () => {
    expect(decodeMappings('AAAA,EAAE;AACA')).toEqual([
      { genLine: 0, genCol: 0, sourceIndex: 0, origLine: 0, origCol: 0 },
      { genLine: 0, genCol: 2, sourceIndex: 0, origLine: 0, origCol: 2 },
      { genLine: 1, genCol: 0, sourceIndex: 0, origLine: 1, origCol: 2 },
    ]);
  });

  it('handles multi-digit and negative values, empty lines and source-less segments', () => {
    // gB = 16 (continuation digit); D = -1; a 1-field segment has no source.
    expect(decodeMappings(';gBAEA,C;AADA')).toEqual([
      { genLine: 1, genCol: 16, sourceIndex: 0, origLine: 2, origCol: 0 },
      { genLine: 2, genCol: 0, sourceIndex: 0, origLine: 1, origCol: 0 },
    ]);
  });
});

describe('readInlineSourceMap', () => {
  it('reads a base64 inline map (last one wins)', () => {
    const map = { version: 3, sources: ['X.tsx'], mappings: 'AAAA;AACA' };
    const b64 = btoa(JSON.stringify(map));
    const src = `code();\n//# sourceMappingURL=data:application/json;base64,${btoa('{}')}\nmore();\n//# sourceMappingURL=data:application/json;base64,${b64}\n`;
    const read = readInlineSourceMap(src);
    expect(read?.sources).toEqual(['X.tsx']);
    expect(read?.segments).toHaveLength(2);
  });

  it('returns null without a (valid) inline map', () => {
    expect(readInlineSourceMap('code();')).toBeNull();
    expect(readInlineSourceMap('//# sourceMappingURL=data:application/json;base64,!!!')).toBeNull();
  });
});

describe('positions and spans', () => {
  const source = 'line0\nline1\nline2\n';
  const starts = lineStarts(source);

  it('maps offsets to 0-based line/col', () => {
    expect(starts).toEqual([0, 6, 12, 18]);
    expect(positionAt(starts, 0)).toEqual({ line: 0, col: 0 });
    expect(positionAt(starts, 7)).toEqual({ line: 1, col: 1 });
    expect(positionAt(starts, 12)).toEqual({ line: 2, col: 0 });
  });

  it('returns the 1-based original line span of segments inside a generated range', () => {
    // gen line 0 → orig line 10, gen line 1 → orig 12, gen line 2 → orig 20
    const segments = decodeMappings('AAUA;AAEA;AAQA');
    expect(originalLineSpan(segments, starts, 0, 12)).toEqual({ from: 11, to: 13 });
    expect(originalLineSpan(segments, starts, 6, 18)).toEqual({ from: 13, to: 21 });
    expect(originalLineSpan(segments, starts, 1, 5)).toBeNull();
  });
});
