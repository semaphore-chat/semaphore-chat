import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { useThemeColorMeta } from '../../hooks/useThemeColorMeta';
import { ThemeProvider, useTheme } from '../../contexts/ThemeContext';
import { generateTheme } from '../../theme/themeConfig';

function metaContent(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;
}

describe('useThemeColorMeta', () => {
  beforeEach(() => {
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
    localStorage.clear();
  });

  it('creates the meta tag when missing and updates it when the colour changes', () => {
    const { rerender } = renderHook(({ color }) => useThemeColorMeta(color), {
      initialProps: { color: '#111111' },
    });
    expect(metaContent()).toBe('#111111');
    rerender({ color: '#eeeeee' });
    expect(metaContent()).toBe('#eeeeee');
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  });

  it('updates an existing meta tag in place', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#1a1a2e';
    document.head.appendChild(meta);
    renderHook(() => useThemeColorMeta('#222222'));
    expect(meta.getAttribute('content')).toBe('#222222');
  });

  it('follows the app ThemeProvider when the mode is toggled', () => {
    function Toggle() {
      const { toggleMode } = useTheme();
      return <button onClick={toggleMode}>toggle</button>;
    }
    render(
      <ThemeProvider>
        <Toggle />
      </ThemeProvider>,
    );
    const first = metaContent();
    expect(first).toMatch(/^#|^rgb/);
    act(() => {
      screen.getByText('toggle').click();
    });
    const second = metaContent();
    expect(second).not.toBe(first);
    // Must be a solid colour, never a gradient
    expect(second).not.toMatch(/gradient/);
  });

  it('uses a solid colour for every mode and intensity', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (const intensity of ['minimal', 'balanced', 'vibrant'] as const) {
        const theme = generateTheme(mode, 'blue', intensity);
        expect(theme.palette.background.paper).not.toMatch(/gradient/);
      }
    }
  });
});
