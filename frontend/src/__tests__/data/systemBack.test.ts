import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { SYSTEM_BACK_QUERY, useSystemBackEnabled } from '../../data/systemBack';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';

function pointer(coarse: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === SYSTEM_BACK_QUERY && coarse,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSystemBackEnabled', () => {
  it('is on for a touch pointer in a browser', () => {
    pointer(true);
    expect(renderHook(() => useSystemBackEnabled()).result.current).toBe(true);
  });

  it('is off with a mouse', () => {
    pointer(false);
    expect(renderHook(() => useSystemBackEnabled()).result.current).toBe(false);
  });

  it('is off in Electron, even on a touch screen', () => {
    pointer(true);
    setElectronAPIOverride(createFakeElectronAPI());
    expect(renderHook(() => useSystemBackEnabled()).result.current).toBe(false);
  });
});
