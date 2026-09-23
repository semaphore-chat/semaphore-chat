import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Snackbar, SnackbarContent } from '@mui/material';
import { decomposeColor, emphasize } from '@mui/material/styles';
import { generateTheme } from '../../theme/themeConfig';
import { THEME_MATRIX, themeLabel, renderInEveryTheme } from '../test-utils/themeMatrix';

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
