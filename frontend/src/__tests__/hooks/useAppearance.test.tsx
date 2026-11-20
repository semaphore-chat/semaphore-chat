import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ACCENT_PRIMARY } from '@semaphore-chat/shared';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { useAppearance, type Appearance } from '../../hooks/useAppearance';
import { STORAGE_KEY } from '../../theme/constants';

let appearance: Appearance;

function Probe() {
  appearance = useAppearance();
  return null;
}

describe('useAppearance', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the stored base colour, mode, intensity and new-design flag', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: 'light',
        accentColor: 'purple',
        intensity: 'vibrant',
        baseColor: ACCENT_PRIMARY.purple,
        newDesign: true,
      }),
    );
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(appearance).toEqual({
      baseColor: ACCENT_PRIMARY.purple,
      mode: 'light',
      intensity: 'vibrant',
      newDesign: true,
    });
  });

  it('reports the OS mode while match-system is on', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        media: '(prefers-color-scheme: dark)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mode: 'light', accentColor: 'teal', intensity: 'minimal', matchSystem: true }),
    );
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(appearance.mode).toBe('dark');
  });
});
