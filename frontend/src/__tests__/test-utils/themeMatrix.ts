/**
 * Theme matrix helpers.
 *
 * Every combination of mode × intensity produces a structurally different MUI
 * theme (e.g. dark + balanced/vibrant used to put a `linear-gradient(...)` in
 * `palette.background.default`, which made MUI's `SnackbarContent` throw).
 * Components that might read theme colours should be rendered under all of
 * them — `renderInEveryTheme` does that and fails loudly with the theme name
 * if any combination throws.
 */
import React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { generateTheme } from '../../theme/themeConfig';
import type { AccentColor, ThemeIntensity, ThemeMode } from '../../theme/constants';

export interface ThemeMatrixEntry {
  mode: ThemeMode;
  intensity: ThemeIntensity;
}

export const THEME_MATRIX: ThemeMatrixEntry[] = (['dark', 'light'] as const).flatMap((mode) =>
  (['minimal', 'balanced', 'vibrant'] as const).map((intensity) => ({ mode, intensity })),
);

export function themeLabel({ mode, intensity }: ThemeMatrixEntry): string {
  return `${mode} + ${intensity}`;
}

export function withMatrixTheme(
  ui: React.ReactElement,
  entry: ThemeMatrixEntry,
  accentColor: AccentColor = 'blue',
): React.ReactElement {
  return React.createElement(
    ThemeProvider,
    { theme: generateTheme(entry.mode, accentColor, entry.intensity) },
    ui,
  );
}

/**
 * Renders `ui` once per theme in THEME_MATRIX (unmounting in between) and
 * calls `assert` after each render. Throws with the theme label attached if a
 * render or an assertion fails.
 *
 * `ui` may be a factory so each render gets fresh elements/state.
 */
export function renderInEveryTheme(
  ui: React.ReactElement | (() => React.ReactElement),
  assert?: (result: RenderResult, entry: ThemeMatrixEntry) => void,
  options: { accentColor?: AccentColor } = {},
): void {
  for (const entry of THEME_MATRIX) {
    const element = typeof ui === 'function' ? ui() : ui;
    let result: RenderResult | undefined;
    try {
      result = render(withMatrixTheme(element, entry, options.accentColor));
      assert?.(result, entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const wrapped = new Error(`[${themeLabel(entry)}] ${message}`);
      if (error instanceof Error && error.stack) wrapped.stack = `${wrapped.message}\n${error.stack}`;
      throw wrapped;
    } finally {
      result?.unmount();
    }
  }
}
