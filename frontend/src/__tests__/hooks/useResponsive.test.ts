import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock isElectron
let mockIsElectron = false;
vi.mock('../../utils/platform', () => ({
  isElectron: () => mockIsElectron,
}));

// Mock useMediaQuery to simulate viewport sizes
let mockMediaQueryResults: Record<string, boolean> = {};
vi.mock('@mui/material/useMediaQuery', () => ({
  default: (query: string) => mockMediaQueryResults[query] ?? false,
}));

// Mock useTheme — only needs breakpoints for MUI backward-compat queries
vi.mock('@mui/material/styles', () => ({
  useTheme: () => ({
    breakpoints: {
      only: (key: string) => `(only-${key})`,
      up: (key: string) => `(up-${key})`,
    },
  }),
}));

import { DEVICE_BREAKPOINTS } from '../../utils/breakpoints';
import { useResponsive, useTabletBreakpoint, useCompactLayout } from '../../hooks/useResponsive';

function setViewportPhone() {
  // < 600px = phone
  mockMediaQueryResults = {
    [`(max-width: ${DEVICE_BREAKPOINTS.PHONE - 1}px)`]: true,
  };
}

function setViewportPhoneLandscape() {
  // 600-767px = phone landscape
  mockMediaQueryResults = {
    [`(min-width: ${DEVICE_BREAKPOINTS.PHONE}px) and (max-width: ${DEVICE_BREAKPOINTS.PHONE_LANDSCAPE - 1}px)`]: true,
  };
}

function setViewportDesktop() {
  // >= 1200px = desktop
  mockMediaQueryResults = {
    [`(min-width: ${DEVICE_BREAKPOINTS.DESKTOP}px)`]: true,
  };
}

function setViewportTabletPortrait() {
  // 768-1023px = tablet portrait (also matches the 768-1199 and < 1200 helpers)
  mockMediaQueryResults = {
    [`(min-width: ${DEVICE_BREAKPOINTS.PHONE_LANDSCAPE}px) and (max-width: ${DEVICE_BREAKPOINTS.TABLET - 1}px)`]: true,
    [`(min-width: ${DEVICE_BREAKPOINTS.PHONE_LANDSCAPE}px) and (max-width: ${DEVICE_BREAKPOINTS.DESKTOP - 1}px)`]: true,
    [`(max-width: ${DEVICE_BREAKPOINTS.DESKTOP - 1}px)`]: true,
  };
}

function setViewportTabletLandscape() {
  // 1024-1199px = tablet landscape (also matches the 768-1199 and < 1200 helpers)
  mockMediaQueryResults = {
    [`(min-width: ${DEVICE_BREAKPOINTS.TABLET}px) and (max-width: ${DEVICE_BREAKPOINTS.DESKTOP - 1}px)`]: true,
    [`(min-width: ${DEVICE_BREAKPOINTS.PHONE_LANDSCAPE}px) and (max-width: ${DEVICE_BREAKPOINTS.DESKTOP - 1}px)`]: true,
    [`(max-width: ${DEVICE_BREAKPOINTS.DESKTOP - 1}px)`]: true,
  };
}

describe('useResponsive', () => {
  beforeEach(() => {
    mockIsElectron = false;
    mockMediaQueryResults = {};
  });

  describe('browser (non-Electron)', () => {
    it('returns isMobile=true at phone viewport', () => {
      setViewportPhone();
      const { result } = renderHook(() => useResponsive());
      expect(result.current.isMobile).toBe(true);
      expect(result.current.isPhone).toBe(true);
      expect(result.current.deviceType).toBe('phone');
    });

    it('returns isMobile=true at phone landscape viewport', () => {
      setViewportPhoneLandscape();
      const { result } = renderHook(() => useResponsive());
      expect(result.current.isMobile).toBe(true);
      expect(result.current.isPhoneLandscape).toBe(true);
      expect(result.current.deviceType).toBe('phone');
    });

    it('returns isMobile=false at desktop viewport', () => {
      setViewportDesktop();
      const { result } = renderHook(() => useResponsive());
      expect(result.current.isMobile).toBe(false);
      expect(result.current.isDesktop).toBe(true);
      expect(result.current.deviceType).toBe('desktop');
    });

    it.each([
      ['portrait', setViewportTabletPortrait, 'isTabletPortrait'],
      ['landscape', setViewportTabletLandscape, 'isTabletLandscape'],
    ] as const)('returns the tablet layout and touch UI at tablet %s viewport', (_, setViewport, flag) => {
      setViewport();
      const { result } = renderHook(() => useResponsive());
      expect(result.current.isTablet).toBe(true);
      expect(result.current[flag]).toBe(true);
      expect(result.current.isDesktop).toBe(false);
      expect(result.current.deviceType).toBe('tablet');
      expect(result.current.shouldUseTouchUI).toBe(true);
    });

    it('never flags isNarrowDesktop (a narrow browser gets the phone or tablet layout)', () => {
      for (const setViewport of [setViewportPhone, setViewportPhoneLandscape, setViewportTabletPortrait, setViewportDesktop]) {
        setViewport();
        expect(renderHook(() => useResponsive()).result.current.isNarrowDesktop).toBe(false);
      }
    });
  });

  describe('Electron', () => {
    beforeEach(() => {
      mockIsElectron = true;
    });

    it('returns isMobile=false even at phone viewport', () => {
      setViewportPhone();
      const { result } = renderHook(() => useResponsive());
      expect(result.current.isMobile).toBe(false);
      expect(result.current.isPhone).toBe(false);
      expect(result.current.deviceType).not.toBe('phone');
    });

    it('returns isMobile=false at phone landscape viewport', () => {
      setViewportPhoneLandscape();
      const { result } = renderHook(() => useResponsive());
      expect(result.current.isMobile).toBe(false);
      expect(result.current.isPhoneLandscape).toBe(false);
      expect(result.current.deviceType).not.toBe('phone');
    });

    it('returns shouldUseTouchUI=false regardless of viewport', () => {
      setViewportPhone();
      // Also simulate touch device
      mockMediaQueryResults['(hover: none) and (pointer: coarse)'] = true;
      const { result } = renderHook(() => useResponsive());
      expect(result.current.shouldUseTouchUI).toBe(false);
    });

    it('preserves desktop detection', () => {
      setViewportDesktop();
      const { result } = renderHook(() => useResponsive());
      expect(result.current.isDesktop).toBe(true);
      expect(result.current.deviceType).toBe('desktop');
    });

    // An Electron window is at least 800px wide (electron/main.ts minWidth),
    // so 800-1199px is where the tablet layout used to leak in.
    it.each([
      ['portrait', setViewportTabletPortrait],
      ['landscape', setViewportTabletLandscape],
    ] as const)('uses the desktop layout at tablet %s viewport', (_, setViewport) => {
      setViewport();
      const { result } = renderHook(() => useResponsive());
      expect(result.current.isTablet).toBe(false);
      expect(result.current.isTabletPortrait).toBe(false);
      expect(result.current.isTabletLandscape).toBe(false);
      expect(result.current.isMobile).toBe(false);
      expect(result.current.isDesktop).toBe(true);
      expect(result.current.deviceType).toBe('desktop');
    });

    it('flags the desktop layout below 1024px as narrow (isNarrowDesktop)', () => {
      setViewportTabletPortrait();
      expect(renderHook(() => useResponsive()).result.current.isNarrowDesktop).toBe(true);
      setViewportPhoneLandscape();
      expect(renderHook(() => useResponsive()).result.current.isNarrowDesktop).toBe(true);
      setViewportTabletLandscape();
      expect(renderHook(() => useResponsive()).result.current.isNarrowDesktop).toBe(false);
      setViewportDesktop();
      expect(renderHook(() => useResponsive()).result.current.isNarrowDesktop).toBe(false);
    });

    it('returns shouldUseTouchUI=false at tablet viewport, even on a touch screen', () => {
      setViewportTabletPortrait();
      mockMediaQueryResults['(hover: none) and (pointer: coarse)'] = true;
      const { result } = renderHook(() => useResponsive());
      expect(result.current.shouldUseTouchUI).toBe(false);
    });
  });
});

describe('useTabletBreakpoint / useCompactLayout', () => {
  beforeEach(() => {
    mockIsElectron = false;
    mockMediaQueryResults = {};
  });

  it('are true at tablet width in a browser', () => {
    setViewportTabletPortrait();
    expect(renderHook(() => useTabletBreakpoint()).result.current).toBe(true);
    expect(renderHook(() => useCompactLayout()).result.current).toBe(true);
  });

  it('are false at tablet width in Electron (always the desktop layout)', () => {
    mockIsElectron = true;
    setViewportTabletLandscape();
    expect(renderHook(() => useTabletBreakpoint()).result.current).toBe(false);
    expect(renderHook(() => useCompactLayout()).result.current).toBe(false);
  });
});
