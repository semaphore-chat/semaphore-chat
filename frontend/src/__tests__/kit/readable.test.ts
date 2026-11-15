import { describe, expect, it } from 'vitest';
import { readableBackground } from '../../kit/theme/readable';
import { derivePalette, type ModeName } from '../../theme/derive/derivePalette';
import { contrastRatio, parseHex, toOklch } from '../../theme/derive/oklch';

const STORY_COLOURS = ['#FF8FB8', '#5FD49A', '#FFA366', '#6FB1F5', '#C792F0', '#5ED1D1', '#FF9A6B', '#9AA0FF'];

function inksFor(mode: ModeName): [string, string] {
  const palette = derivePalette('#8E75FF', mode, 'minimal');
  return [palette.ground, palette.text];
}

describe('readableBackground', () => {
  it.each([['dark'], ['light']] as const)(
    'reaches 4.5:1 for every colour of an 8x8x8 sweep in %s mode',
    (mode) => {
      const inks = inksFor(mode);
      const steps = [0, 51, 102, 119, 128, 153, 204, 255];
      for (const r of steps) {
        for (const g of steps) {
          for (const b of steps) {
            const colour = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
            const result = readableBackground(colour, inks);
            expect(result, colour).not.toBeNull();
            expect(inks, colour).toContain(result?.ink);
            expect(
              contrastRatio(parseHex(result?.ink ?? ''), parseHex(result?.background ?? '')),
              colour,
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    },
  );

  it.each([['dark'], ['light']] as const)('returns the story colours unchanged in %s mode', (mode) => {
    for (const colour of STORY_COLOURS) {
      expect(readableBackground(colour, inksFor(mode))?.background, colour).toBe(colour);
    }
  });

  it('changes a failing mid-grey and pure red (light mode) but keeps the hue of the red', () => {
    for (const mode of ['dark', 'light'] as const) {
      const grey = readableBackground('#777777', inksFor(mode));
      expect(grey?.background, mode).not.toBe('#777777');
    }
    const red = readableBackground('#ff0000', inksFor('light'));
    expect(red?.background).not.toBe('#ff0000');
    const [, , before] = toOklch(parseHex('#ff0000'));
    const [, , after] = toOklch(parseHex(red?.background ?? ''));
    expect(Math.abs(after - before)).toBeLessThan(0.05);
  });

  it('keeps an already readable mid-grey (#808080) as given', () => {
    expect(readableBackground('#808080', inksFor('dark'))?.background).toBe('#808080');
  });

  it.each([[''], ['red'], ['#fff'], ['#12345'], ['#gggggg'], ['#ff8fb8aa']])(
    'returns null for %j instead of throwing',
    (colour) => {
      expect(readableBackground(colour, inksFor('dark'))).toBeNull();
    },
  );
});
