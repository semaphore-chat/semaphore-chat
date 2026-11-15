import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { renderHook } from '@testing-library/react';
import { media, useWidthRange } from '../../../kit';
import { tokens } from '../../../theme/generated/tokens';
import { WIDTH, mockViewport, removeMatchMedia } from './matchMedia';

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

  it('follows the viewport as it changes', () => {
    const viewport = mockViewport(WIDTH.wide);
    const { result } = renderHook(() => useWidthRange());
    expect(result.current).toBe('wide');
    viewport.setWidth(WIDTH.compact);
    expect(result.current).toBe('compact');
    viewport.setWidth(WIDTH.phone);
    expect(result.current).toBe('phone');
    viewport.setWidth(WIDTH.wide);
    expect(result.current).toBe('wide');
  });

  it('is wide when matchMedia is unavailable', () => {
    removeMatchMedia();
    expect(renderHook(() => useWidthRange()).result.current).toBe('wide');
  });
});

describe('media', () => {
  it('builds every query from the breakpoint tokens', () => {
    expect(media.wide).toContain(`${tokens.breakpoint.docked}px`);
    expect(media.abovePhone).toContain(`${tokens.breakpoint.phone}px`);
    expect(media.phone).toContain(`${tokens.breakpoint.phone}px`);
    expect(media.compact).toContain(`${tokens.breakpoint.phone}px`);
    expect(media.compact).toContain(`${tokens.breakpoint.docked}px`);
    expect(media.belowWide).toContain(`${tokens.breakpoint.docked}px`);
    for (const query of Object.values(media)) {
      expect(query.startsWith('@media ')).toBe(false);
    }
  });
});
