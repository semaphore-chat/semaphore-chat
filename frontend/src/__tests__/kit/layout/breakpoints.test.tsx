import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { renderHook } from '@testing-library/react';
import { media, useWidthRange } from '../../../kit';
import { tokens } from '../../../theme/generated/tokens';
import { WIDTH, matches, mockViewport, removeMatchMedia } from './matchMedia';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('useWidthRange', () => {
  it.each([
    ['phone', WIDTH.phone],
    ['compact', tokens.breakpoint.phone],
    ['compact', WIDTH.compact],
    ['wide', WIDTH.wide],
  ] as const)('is %s at %d px', (range, width) => {
    mockViewport(width);
    expect(renderHook(() => useWidthRange()).result.current).toBe(range);
  });

  it('follows the viewport as it changes', async () => {
    const viewport = mockViewport(WIDTH.wide);
    const { result } = renderHook(() => useWidthRange());
    expect(result.current).toBe('wide');
    await viewport.setWidth(WIDTH.compact);
    expect(result.current).toBe('compact');
    await viewport.setWidth(WIDTH.phone);
    expect(result.current).toBe('phone');
    await viewport.setWidth(WIDTH.wide);
    expect(result.current).toBe('wide');
  });

  it('is wide when matchMedia is unavailable', () => {
    removeMatchMedia();
    expect(renderHook(() => useWidthRange()).result.current).toBe('wide');
  });
});

describe('media', () => {
  it('splits every width into exactly one range, with the boundaries at the tokens', () => {
    const cases: [number, 'phone' | 'compact' | 'wide'][] = [
      [0, 'phone'],
      [tokens.breakpoint.phone - 1, 'phone'],
      [tokens.breakpoint.phone - 0.5, 'phone'],
      [tokens.breakpoint.phone, 'compact'],
      [tokens.breakpoint.docked - 1, 'compact'],
      [tokens.breakpoint.docked - 0.5, 'compact'],
      [tokens.breakpoint.docked, 'wide'],
      [2560, 'wide'],
    ];
    for (const [width, range] of cases) {
      const hit = (['phone', 'compact', 'wide'] as const).filter((name) => matches(media[name], width));
      expect(hit, `at ${width}`).toEqual([range]);
      expect(matches(media.belowWide, width), `belowWide at ${width}`).toBe(range !== 'wide');
      expect(matches(media.abovePhone, width), `abovePhone at ${width}`).toBe(range !== 'phone');
    }
  });

  it('is a plain query: no at-rule prefix, so matchMedia can take it as it is', () => {
    for (const query of Object.values(media)) {
      expect(query.startsWith('@media ')).toBe(false);
    }
  });
});
