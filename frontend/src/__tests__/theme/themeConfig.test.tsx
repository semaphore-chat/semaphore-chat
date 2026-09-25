import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Snackbar, SnackbarContent } from '@mui/material';
import { decomposeColor, emphasize, getContrastRatio, type Theme } from '@mui/material/styles';
import { generateTheme, readableTextColor } from '../../theme/themeConfig';
import { accentColors } from '../../theme/constants';
import { THEME_MATRIX, themeLabel, renderInEveryTheme } from '../test-utils/themeMatrix';
import { compositeOver } from '../test-utils/color';

type AppBarRoot = { backgroundColor: string; background?: string; color?: string };

function appBarRoot(theme: Theme): AppBarRoot {
  return (theme.components?.MuiAppBar?.styleOverrides as { root: AppBarRoot }).root;
}

/** Every solid colour the app bar can show behind its content: the fill plus each gradient stop. */
function appBarSurfaceColors(theme: Theme): string[] {
  const root = appBarRoot(theme);
  return [root.backgroundColor, ...(root.background?.match(/#[0-9a-f]{6}/gi) ?? [])];
}

type ChipRoot = { backgroundColor: string; color: string; [selector: string]: unknown };

function chipRoot(theme: Theme): ChipRoot {
  return (theme.components?.MuiChip?.styleOverrides as { root: ChipRoot }).root;
}

/** The tint the override paints on a hovered/focused clickable chip. */
function chipHoverBackground(theme: Theme): string {
  const [, rule] = Object.entries(chipRoot(theme)).find(([selector]) => selector.includes(':hover')) ?? [];
  return (rule as { backgroundColor: string }).backgroundColor;
}

describe('generateTheme', () => {
  it.each(THEME_MATRIX)('keeps background.default a solid colour ($mode + $intensity)', (entry) => {
    const theme = generateTheme(entry.mode, 'blue', entry.intensity);
    // MUI runs colour maths on these; a gradient throws.
    expect(() => decomposeColor(theme.palette.background.default), themeLabel(entry)).not.toThrow();
    expect(() => emphasize(theme.palette.background.default, 0.9)).not.toThrow();
    expect(() => decomposeColor(theme.palette.background.paper)).not.toThrow();
  });

  it('keeps the gradient for page grounds in dark + balanced/vibrant only', () => {
    for (const entry of THEME_MATRIX) {
      const { ground, default: solid } = generateTheme(entry.mode, 'blue', entry.intensity).palette.background;
      if (entry.mode === 'dark' && entry.intensity !== 'minimal') {
        expect(ground, themeLabel(entry)).toMatch(/^linear-gradient\(/);
      } else {
        expect(ground, themeLabel(entry)).toBe(solid);
      }
    }
  });

  it('lets the body page gradient show through full-screen containers (background.canvas)', () => {
    // Mobile/tablet screen stacks, thread panel, admin main etc. paint
    // background.canvas; it must stay transparent wherever the body carries
    // the accent gradient, or dark balanced/vibrant looks like minimal.
    for (const entry of THEME_MATRIX) {
      const { canvas, default: solid } = generateTheme(entry.mode, 'rose', entry.intensity).palette.background;
      if (entry.mode === 'dark' && entry.intensity !== 'minimal') {
        expect(canvas, themeLabel(entry)).toBe('transparent');
      } else {
        expect(canvas, themeLabel(entry)).toBe(solid);
      }
    }
  });

  it.each(THEME_MATRIX)('derives snackbar text colour from its background ($mode + $intensity)', (entry) => {
    const theme = generateTheme(entry.mode, 'blue', entry.intensity);
    const root = (theme.components?.MuiSnackbarContent?.styleOverrides as { root: { backgroundColor: string; color: string } }).root;
    expect(root.color).toBe(theme.palette.getContrastText(root.backgroundColor));
  });

  // The override repaints the app bar as a neutral/pale-tinted surface, so
  // its foreground (inherited by color="inherit" icons such as the
  // notification bell) must be the surface's text token, not MUI's light-mode
  // default of primary.contrastText, which is white for most accents: white
  // icons on the white / pale-tinted light bar.
  it.each(THEME_MATRIX)('paints app-bar content in text.primary for every accent ($mode + $intensity)', (entry) => {
    for (const { id } of accentColors) {
      const theme = generateTheme(entry.mode, id, entry.intensity);
      expect(appBarRoot(theme).color, `${themeLabel(entry)}, ${id}`).toBe(theme.palette.text.primary);
    }
  });

  it.each(THEME_MATRIX)('keeps app-bar content at WCAG AA contrast on every stop of the bar ($mode + $intensity)', (entry) => {
    for (const { id } of accentColors) {
      const theme = generateTheme(entry.mode, id, entry.intensity);
      const foreground = theme.palette.text.primary;
      for (const surface of appBarSurfaceColors(theme)) {
        const ratio = getContrastRatio(foreground, surface);
        // 3:1 is the WCAG 1.4.11 minimum for icons; the instance name in the
        // same bar is text, so hold the whole bar to the 4.5:1 text minimum.
        expect(ratio, `${themeLabel(entry)}, ${id}: ${foreground} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // Every chip is an accent tint with accent text (the override replaces
  // MUI's per-colour fills). accent.lighter on the pale light-mode tint was
  // ~1.0-1.8:1, e.g. the voice bar's "Connected" chip.
  it.each(THEME_MATRIX)('keeps chip text at WCAG AA on the chip tint, at rest and hovered, for every accent ($mode + $intensity)', (entry) => {
    for (const { id } of accentColors) {
      const theme = generateTheme(entry.mode, id, entry.intensity);
      const { color, backgroundColor } = chipRoot(theme);
      for (const surface of [theme.palette.background.paper, theme.palette.background.default]) {
        for (const tint of [backgroundColor, chipHoverBackground(theme)]) {
          const painted = compositeOver(tint, surface);
          const ratio = getContrastRatio(color, painted);
          expect(ratio, `${themeLabel(entry)}, ${id}: ${color} on ${painted}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('keeps accent.lighter as the dark-mode chip text where it already passes', () => {
    expect(chipRoot(generateTheme('dark', 'teal', 'minimal')).color).toBe('#5eead4');
    expect(chipRoot(generateTheme('dark', 'purple', 'balanced')).color).toBe('#c4b5fd');
    expect(chipRoot(generateTheme('dark', 'amber', 'minimal')).color).toBe('#fcd34d');
  });

  it('keeps the accent hue for light-mode chip text (accent.dark when it passes)', () => {
    // Indigo's dark shade already reaches 4.5:1 on its minimal tint.
    expect(chipRoot(generateTheme('light', 'indigo', 'minimal')).color).toBe('#4f46e5');
    expect(chipRoot(generateTheme('light', 'purple', 'vibrant')).color).not.toBe('#000000');
  });

  it('renders snackbars (message prop and SnackbarContent) in every theme', () => {
    renderInEveryTheme(
      () => (
        <>
          <Snackbar open message="snack message" />
          <SnackbarContent message="content message" />
        </>
      ),
      () => {
        expect(screen.getByText('snack message')).toBeInTheDocument();
        expect(screen.getByText('content message')).toBeInTheDocument();
      },
    );
  });
});

describe('readableTextColor', () => {
  it('returns the preferred colour when it already passes', () => {
    expect(readableTextColor('#1a1a1a', ['#ffffff', '#f5f5f5'], '#000000')).toBe('#1a1a1a');
  });

  it('moves a failing colour towards the target only as far as needed', () => {
    const result = readableTextColor('#c4b5fd', ['#ffffff'], '#000000');
    expect(result).not.toBe('#c4b5fd');
    expect(result).not.toBe('#000000');
    expect(getContrastRatio(result, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('checks every backdrop', () => {
    // Passes on the first backdrop as is, not on the second.
    const result = readableTextColor('#5eead4', ['#1a1d24', '#2f6f6a'], '#ffffff');
    expect(result).not.toBe('#5eead4');
    expect(getContrastRatio(result, '#1a1d24')).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(result, '#2f6f6a')).toBeGreaterThanOrEqual(4.5);
  });

  it('falls back to the target colour when nothing else passes', () => {
    // White on teal-600 is only 3.7:1.
    expect(readableTextColor('#5eead4', ['#0d9488'], '#ffffff')).toBe('#ffffff');
  });
});
