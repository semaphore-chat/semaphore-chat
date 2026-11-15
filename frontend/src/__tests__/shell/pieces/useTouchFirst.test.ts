/**
 * The touch-first rule of the Lounge call bar matches the classic bar's `shouldUseTouchUI`: never in Electron;
 * otherwise a touch device, or a width below wide (the classic phone and tablet widths).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const platform = vi.hoisted(() => ({ electron: false }));
vi.mock('../../../utils/platform', () => ({ isElectron: () => platform.electron }));

import { useTouchFirst } from '../../../shell/lounge/pieces/call/useTouchFirst';

const original = window.matchMedia;
function touchDevice(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on && query === '(hover: none) and (pointer: coarse)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}
beforeEach(() => {
  platform.electron = false;
  touchDevice(false);
});
afterEach(() => {
  window.matchMedia = original;
});

describe('useTouchFirst', () => {
  it.each([
    ['phone, mouse', 'phone', false, false, true],
    ['compact, mouse', 'compact', false, false, true],
    ['wide, mouse', 'wide', false, false, false],
    ['wide, touch device', 'wide', true, false, true],
    ['phone width in Electron', 'phone', false, true, false],
    ['touch device in Electron', 'wide', true, true, false],
  ] as const)('%s', (_name, range, touch, electron, expected) => {
    touchDevice(touch);
    platform.electron = electron;
    expect(renderHook(() => useTouchFirst(range)).result.current).toBe(expected);
  });
});
