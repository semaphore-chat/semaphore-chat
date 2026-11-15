import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useTheme as useMuiTheme, type Theme } from '@mui/material/styles';
import { ACCENT_PRIMARY, nearestAccent } from '@semaphore-chat/shared';
import { ThemeProvider, useTheme, type ThemeContextValue } from '../../contexts/ThemeContext';
import { STORAGE_KEY, accentColors, defaultSettings } from '../../theme/constants';
import { generateTheme } from '../../theme/themeConfig';

let latest: ThemeContextValue;

function Probe() {
  latest = useTheme();
  return null;
}

function ThemeProbe({ onTheme }: { onTheme: (theme: Theme) => void }) {
  onTheme(useMuiTheme());
  return null;
}

/** Render the provider, exposing both the context value (`latest`) and its MUI theme. */
function renderTheme() {
  let muiTheme: Theme | undefined;
  const view = render(
    <ThemeProvider>
      <Probe />
      <ThemeProbe onTheme={(theme) => (muiTheme = theme)} />
    </ThemeProvider>,
  );
  return {
    ...view,
    get theme() {
      return muiTheme!;
    },
  };
}

/**
 * A fake `(prefers-color-scheme: dark)` list: `set()` flips the OS preference
 * and fires `change` on every registered listener, like a real MediaQueryList.
 */
function installColorScheme(initial: 'dark' | 'light') {
  const state = { dark: initial === 'dark' };
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() {
      return state.dark;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  const matchMedia = vi.fn(() => query);
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    query,
    matchMedia,
    listeners,
    set(dark: boolean) {
      state.dark = dark;
      act(() => {
        listeners.forEach((listener) => listener({ matches: dark } as MediaQueryListEvent));
      });
    },
  };
}

describe('ThemeProvider appearance settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the default accent primary, no match-system and no new design', () => {
    renderTheme();
    expect(latest.settings.baseColor).toBe(ACCENT_PRIMARY.teal);
    expect(latest.settings.baseColor).toBe(defaultSettings.baseColor);
    expect(latest.baseColor).toBe(ACCENT_PRIMARY.teal);
    expect(latest.matchSystem).toBe(false);
    expect(latest.newDesign).toBe(false);
    expect(latest.effectiveMode).toBe('dark');
  });

  it('migrates old stored settings that have no baseColor to the stored accent primary', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mode: 'light', accentColor: 'purple', intensity: 'vibrant' }),
    );
    renderTheme();
    expect(latest.settings).toEqual({
      mode: 'light',
      accentColor: 'purple',
      intensity: 'vibrant',
      baseColor: ACCENT_PRIMARY.purple,
      matchSystem: false,
      newDesign: false,
    });
    expect(latest.effectiveMode).toBe('light');
  });

  it('falls back field by field for malformed stored values', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: 'sepia',
        accentColor: 'chartreuse',
        intensity: 42,
        baseColor: '#12345',
        matchSystem: 'yes',
        newDesign: 1,
      }),
    );
    renderTheme();
    expect(latest.settings).toEqual(defaultSettings);
  });

  it('keeps the stored accent when only the stored baseColor is bad', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ accentColor: 'rose', baseColor: 'pink', intensity: 'balanced' }),
    );
    renderTheme();
    expect(latest.settings.accentColor).toBe('rose');
    expect(latest.settings.baseColor).toBe(ACCENT_PRIMARY.rose);
  });

  it('does not throw on unparsable or non-object stored JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(() => renderTheme()).not.toThrow();
    expect(latest.settings).toEqual(defaultSettings);

    localStorage.setItem(STORAGE_KEY, 'null');
    expect(() => renderTheme()).not.toThrow();
    expect(latest.settings).toEqual(defaultSettings);
  });

  it('builds the same MUI theme as before for every named accent', () => {
    for (const { id } of accentColors) {
      for (const mode of ['dark', 'light'] as const) {
        localStorage.clear();
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ mode, accentColor: id, intensity: 'balanced' }),
        );
        const view = renderTheme();
        const expected = generateTheme(mode, id, 'balanced');
        expect(view.theme.palette.mode).toBe(expected.palette.mode);
        expect(view.theme.palette.primary.main).toBe(expected.palette.primary.main);
        expect(view.theme.palette.background.default).toBe(expected.palette.background.default);
        view.unmount();
      }
    }
  });

  it('uses the nearest named accent for a custom base colour', () => {
    const view = renderTheme();
    act(() => latest.setBaseColor('#FF9A6B'));
    const accent = nearestAccent('#ff9a6b');
    expect(latest.baseColor).toBe('#ff9a6b');
    expect(latest.settings.accentColor).toBe(accent);
    expect(view.theme.palette.primary.main).toBe(
      generateTheme('dark', accent, 'minimal').palette.primary.main,
    );
  });

  it('follows the OS colour scheme live while match-system is on', () => {
    const scheme = installColorScheme('dark');
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mode: 'light', accentColor: 'teal', intensity: 'minimal', matchSystem: true }),
    );
    const view = renderTheme();
    expect(latest.effectiveMode).toBe('dark');
    expect(view.theme.palette.mode).toBe('dark');

    scheme.set(false);
    expect(latest.effectiveMode).toBe('light');
    expect(view.theme.palette.mode).toBe('light');
  });

  it('listens to matchMedia only while match-system is on, and stops on unmount', () => {
    const scheme = installColorScheme('dark');
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mode: 'light', accentColor: 'teal', intensity: 'minimal' }),
    );
    const view = renderTheme();
    expect(scheme.query.addEventListener).not.toHaveBeenCalled();
    expect(latest.effectiveMode).toBe('light');

    // The OS flips, but match-system is off: nothing changes.
    scheme.set(true);
    expect(latest.effectiveMode).toBe('light');

    act(() => latest.setMatchSystem(true));
    expect(latest.effectiveMode).toBe('dark');
    expect(scheme.query.addEventListener).toHaveBeenCalledTimes(1);

    act(() => latest.setMatchSystem(false));
    expect(scheme.listeners.size).toBe(0);
    expect(latest.effectiveMode).toBe('light');

    act(() => latest.setMatchSystem(true));
    expect(scheme.listeners.size).toBe(1);
    view.unmount();
    expect(scheme.listeners.size).toBe(0);
  });

  it('does not throw where matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ matchSystem: true }));
    expect(() => renderTheme()).not.toThrow();
    // No OS signal: light, as a browser without `prefers-color-scheme` assumes.
    expect(latest.effectiveMode).toBe('light');
  });

  it('keeps accentColor and baseColor in step, ignoring an invalid base colour', () => {
    renderTheme();

    act(() => latest.setBaseColor('#FF9A6B'));
    const accent = nearestAccent('#ff9a6b');
    expect(latest.baseColor).toBe('#ff9a6b');
    expect(latest.settings.accentColor).toBe(accent);

    act(() => latest.setBaseColor('orange'));
    expect(latest.baseColor).toBe('#ff9a6b');
    expect(latest.settings.accentColor).toBe(accent);

    act(() => latest.setAccentColor('rose'));
    expect(latest.settings.accentColor).toBe('rose');
    expect(latest.baseColor).toBe(ACCENT_PRIMARY.rose);
  });

  it('toggles the new-design flag independently of the mode', () => {
    renderTheme();
    act(() => latest.setNewDesign(true));
    expect(latest.newDesign).toBe(true);
    expect(latest.settings.mode).toBe('dark');
  });
});
