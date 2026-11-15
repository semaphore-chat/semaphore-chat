import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { shadow } from '../../kit/theme/shadow';
import type { LoungeTheme } from '../../kit';
import { derivePalette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const lounge = (mode: 'dark' | 'light'): LoungeTheme => ({
  tokens,
  palette: derivePalette('#8E75FF', mode, 'minimal'),
  mode,
});

describe('shadow', () => {
  it('uses the dark-mode css in dark mode', () => {
    expect(shadow(lounge('dark'), 'overlay')).toBe(tokens.shadow.overlay.css);
    expect(shadow(lounge('dark'), 'island')).toBe(tokens.shadow.island.css);
  });

  it('uses the light-mode css in light mode, and it is lighter', () => {
    expect(shadow(lounge('light'), 'overlay')).toBe(tokens.shadow.overlay.cssLight);
    expect(shadow(lounge('light'), 'island')).toBe(tokens.shadow.island.cssLight);
    expect(tokens.shadow.overlay.alphaLight).toBeLessThan(tokens.shadow.overlay.alpha);
  });
});
