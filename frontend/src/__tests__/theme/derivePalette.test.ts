import { it, expect } from 'vitest';
import { colourIntensities, colourModes } from '../../theme/generated/colourParams';
import { colourVectors } from '../../theme/generated/colourVectors';
import { derivePalette } from '../../theme/derive/derivePalette';
import type { ColourRole } from '../../theme/derive/derivePalette';
import { contrastRatio, parseHex } from '../../theme/derive/oklch';

/** `colorsys.hsv_to_rgb` as `#rrggbb`, channels rounded to 8 bits. */
function hsvHex(h: number, s: number, v: number): string {
  const sector = h * 6;
  const i = Math.floor(sector);
  const f = sector - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = (
    [
      [v, t, p],
      [q, v, p],
      [p, v, t],
      [p, q, v],
      [t, p, v],
      [v, p, q],
    ] as const
  )[i % 6];
  const channels = [r, g, b].map((c) =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${channels.join('')}`;
}

it('reproduces every shared vector', () => {
  expect(colourVectors).toHaveLength(96);
  for (const v of colourVectors) {
    expect(
      derivePalette(v.base, v.mode, v.intensity),
      `${v.base} ${v.mode} ${v.intensity}`,
    ).toEqual(v.roles);
  }
});

it('gives the approved default palette', () => {
  const p = derivePalette('#8E75FF', 'dark', 'minimal');
  expect([p.ground, p.surface, p.fill, p.accent, p.accentText, p.scrim]).toEqual([
    '#121214',
    '#1b1b1f',
    '#26262c',
    '#8e75ff',
    '#afa5fe',
    '#09081199',
  ]);
});

it('ignores hex case and rejects anything but #rrggbb', () => {
  expect(derivePalette('#8e75ff', 'light', 'vibrant')).toEqual(
    derivePalette('#8E75FF', 'light', 'vibrant'),
  );
  for (const bad of ['', '#fff', 'red', '#8E75FF00', '8E75FF']) {
    expect(() => derivePalette(bad, 'dark', 'minimal')).toThrow(RangeError);
  }
});

it('keeps text readable for every hue', () => {
  // hue 0..350 step 10 at hsv (1,1) and (0.6,0.9), both modes, all intensities:
  // the Review Focus item 3 rules, using contrastRatio(parseHex(a), parseHex(b.slice(0, 7))).
  const bases: string[] = [];
  for (let hue = 0; hue < 360; hue += 10) {
    for (const [s, v] of [
      [1, 1],
      [0.6, 0.9],
    ] as const) {
      bases.push(hsvHex(hue / 360, s, v));
    }
  }
  const surfaces = ['ground', 'surface', 'fill'] as const;
  const textRoles = ['text', 'textSecondary', 'accentText', 'positive', 'warning', 'danger'] as const;
  for (const base of bases) {
    for (const mode of ['dark', 'light'] as const) {
      for (const intensity of ['minimal', 'balanced', 'vibrant'] as const) {
        const palette = derivePalette(base, mode, intensity);
        const check = (role: ColourRole, background: ColourRole, target: number) => {
          const got = contrastRatio(
            parseHex(palette[role]),
            parseHex(palette[background].slice(0, 7)),
          );
          expect(
            got,
            `${base} ${mode} ${intensity}: ${role} ${palette[role]} on ${background} ` +
              `${palette[background]} is ${got.toFixed(3)}:1, need ${target}:1`,
          ).toBeGreaterThanOrEqual(target);
        };
        for (const role of textRoles) {
          for (const background of surfaces) {
            check(role, background, 4.5);
          }
        }
        check('textDim', 'ground', 4.5);
        check('textDim', 'surface', 4.5);
        check('accent', 'ground', 3);
        check('accent', 'surface', 3);
        check('onAccent', 'accent', 4.5);
        check('onDanger', 'danger', 4.5);
      }
    }
  }
});

it('rejects a mode that is not a colour mode', () => {
  expect(() => derivePalette('#8E75FF', 'sepia' as never, 'minimal')).toThrow(RangeError);
});

it('rejects an intensity that is not a colour intensity', () => {
  expect(() => derivePalette('#8E75FF', 'dark', 'loud' as never)).toThrow(RangeError);
});

it('exports the valid colour mode and intensity names', () => {
  expect(colourModes).toEqual(['dark', 'light']);
  expect(colourIntensities).toEqual(['minimal', 'balanced', 'vibrant']);
});
