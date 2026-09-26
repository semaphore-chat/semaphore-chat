import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Box } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { generateTheme } from '../../theme/themeConfig';
import { TYPE_SCALE, ICON_SCALE, FONT_FAMILY, RADIUS_UNIT } from '../../theme/tokens';
import { THEME_MATRIX, themeLabel } from '../test-utils/themeMatrix';

const VARIANTS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'subtitle1', 'subtitle2', 'body1', 'body2', 'button', 'caption', 'overline',
] as const;

/** The parts of the theme that make up the type system, in a snapshot-friendly shape. */
function typographyTokens(theme = generateTheme('dark', 'blue', 'minimal')) {
  const t = theme.typography;
  return {
    fontFamily: t.fontFamily,
    htmlFontSize: t.htmlFontSize,
    fontSize: t.fontSize,
    scale: t.scale,
    icon: t.icon,
    variants: Object.fromEntries(
      VARIANTS.map((v) => [v, { fontSize: t[v].fontSize, fontWeight: t[v].fontWeight, lineHeight: t[v].lineHeight }]),
    ),
    borderRadius: theme.shape.borderRadius,
  };
}

describe('theme type scale and shape', () => {
  it('matches the typography token snapshot', () => {
    expect(typographyTokens()).toMatchSnapshot();
  });

  it('exposes the named scales on theme.typography so sx can resolve "scale.*" / "icon.*"', () => {
    const theme = generateTheme('light', 'teal', 'balanced');
    expect(theme.typography.scale).toEqual(TYPE_SCALE);
    expect(theme.typography.icon).toEqual(ICON_SCALE);
    expect(theme.typography.fontFamily).toBe(FONT_FAMILY);
    expect(FONT_FAMILY.startsWith('"Roboto"')).toBe(true);
  });

  it('builds every standard variant from the named scale (no off-scale sizes)', () => {
    const theme = generateTheme('dark', 'blue', 'vibrant');
    const allowed = new Set<string>(Object.values(TYPE_SCALE));
    for (const v of VARIANTS) {
      expect(allowed.has(theme.typography[v].fontSize as string), `${v} = ${theme.typography[v].fontSize}`).toBe(true);
    }
  });

  it('only uses font weights that are actually loaded (400/500/600/700)', () => {
    const theme = generateTheme('dark', 'blue', 'minimal');
    for (const v of VARIANTS) {
      expect([400, 500, 600, 700], v).toContain(theme.typography[v].fontWeight);
    }
  });

  it('keeps the same type system in every mode and intensity', () => {
    const reference = typographyTokens();
    for (const entry of THEME_MATRIX) {
      expect(typographyTokens(generateTheme(entry.mode, 'rose', entry.intensity)), themeLabel(entry)).toEqual(reference);
    }
  });

  it('sets the corner radius unit explicitly', () => {
    expect(generateTheme('dark', 'blue', 'minimal').shape.borderRadius).toBe(RADIUS_UNIT);
  });

  it('resolves sx fontSize tokens against the theme', () => {
    // getComputedStyle() returns font sizes in px (jsdom >= 30, like a
    // browser), so compare against the token converted with the root font
    // size. The wrapper's odd font size is what an unresolved token (invalid
    // CSS, dropped) would inherit, so it can't pass by coincidence.
    render(
      <ThemeProvider theme={generateTheme('dark', 'blue', 'minimal')}>
        <div style={{ fontSize: '7px' }}>
          <Box data-testid="text" sx={{ fontSize: 'scale.sm' }}>text</Box>
          <Box data-testid="icon" sx={{ fontSize: 'icon.md' }}>icon</Box>
        </div>
      </ThemeProvider>,
    );
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const remToPx = (rem: string) => {
      expect(rem).toMatch(/^[\d.]+rem$/);
      return `${parseFloat(rem) * rootPx}px`;
    };
    expect(screen.getByTestId('text')).toHaveStyle({ fontSize: remToPx(TYPE_SCALE.sm) });
    expect(screen.getByTestId('icon')).toHaveStyle({ fontSize: remToPx(ICON_SCALE.md) });
  });

  it('only references scale/icon tokens that exist (catches typos that would silently emit invalid CSS)', () => {
    const sources = import.meta.glob('../../{components,pages}/**/*.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const bad: string[] = [];
    let uses = 0;
    for (const [file, src] of Object.entries(sources)) {
      for (const m of src.matchAll(/['"](scale|icon)\.([\w-]+)['"]/g)) {
        uses++;
        const table: Record<string, string> = m[1] === 'scale' ? TYPE_SCALE : ICON_SCALE;
        if (!(m[2] in table)) bad.push(`${file}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
    expect(uses).toBeGreaterThan(50);
  });

  it('leaves no hard-coded font sizes in the former worst offenders', () => {
    const sources = import.meta.glob(
      [
        '../../components/Voice/components/CompactUserItem.tsx',
        '../../components/Common/EmptyState.tsx',
        '../../components/Voice/VideoTile.tsx',
      ],
      { query: '?raw', import: 'default', eager: true },
    ) as Record<string, string>;
    expect(Object.keys(sources)).toHaveLength(3);
    for (const [file, src] of Object.entries(sources)) {
      expect(src.match(/fontSize\s*:\s*['"]?\d[\d.]*(px|rem)?['"]?/g), file).toBeNull();
    }
  });
});
