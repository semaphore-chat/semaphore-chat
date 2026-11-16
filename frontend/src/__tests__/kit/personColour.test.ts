import { describe, expect, it } from 'vitest';
import { fnv1a32, personColour, PEOPLE_COLOURS } from '../../kit/theme/personColour';
import { personColourVectors } from '../../theme/generated/personColourVectors';

// `personColourVectors` is the generated copy of design/vectors/person-colour.json (the test container
// mounts only frontend/); `gen_tokens.py --check` in CI fails when the two differ.
describe('personColour', () => {
  it('matches every shared vector', () => {
    expect(personColourVectors.length).toBeGreaterThan(20);
    for (const vector of personColourVectors) {
      expect(`0x${fnv1a32(vector.id).toString(16).padStart(8, '0')}`, vector.id).toBe(vector.fnv1a32);
      expect(personColour(vector.id) ?? null, vector.id).toBe(vector.colour);
    }
  });

  it('gives the published FNV-1a values', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('gives no colour (the neutral fill) for a missing or empty id', () => {
    expect(personColour(undefined)).toBeUndefined();
    expect(personColour(null)).toBeUndefined();
    expect(personColour('')).toBeUndefined();
  });

  it('hashes UTF-8 bytes, not UTF-16 code units', () => {
    // "é" is one UTF-16 unit but two UTF-8 bytes (c3 a9); "😀" is two units, four bytes.
    const utf8 = (text: string) => {
      let hash = 0x811c9dc5;
      for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
      return hash;
    };
    const utf16 = (text: string) => {
      let hash = 0x811c9dc5;
      for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ (text.charCodeAt(i) & 0xff), 0x01000193) >>> 0;
      return hash;
    };
    for (const id of ['zoë', 'José', '名前', '😀']) {
      expect(fnv1a32(id)).toBe(utf8(id));
      expect(fnv1a32(id)).not.toBe(utf16(id));
    }
  });

  it('uses the nine frozen colours', () => {
    expect(PEOPLE_COLOURS).toEqual([
      '#FF8FB8', '#FFA366', '#E0C060', '#A6D36A', '#5FD49A', '#5ED1D1', '#6FB1F5', '#9AA0FF', '#C792F0',
    ]);
  });

  it('spreads realistic ids over all nine colours', () => {
    // A fixed pseudo-random source, so the ids are the same every run.
    let seed = 0x2545f491;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed;
    };
    const hex = (n: number) => Array.from({ length: n }, () => (next() >>> 28).toString(16)).join('');
    const alnum = (n: number) => Array.from({ length: n }, () => (next() >>> 26).toString(36).slice(-1)).join('');
    const uuids = Array.from({ length: 90 }, () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`);
    const cuids = Array.from({ length: 90 }, () => `c${alnum(24)}`);
    for (const ids of [uuids, cuids]) {
      const counts = new Map<string, number>();
      for (const id of ids) {
        const colour = personColour(id) as string;
        counts.set(colour, (counts.get(colour) ?? 0) + 1);
      }
      expect([...counts.keys()].sort()).toEqual([...PEOPLE_COLOURS].sort());
      // 90 ids over 9 colours: about 10 each; none starved or swamped.
      for (const count of counts.values()) {
        expect(count).toBeGreaterThanOrEqual(3);
        expect(count).toBeLessThanOrEqual(20);
      }
    }
  });
});
