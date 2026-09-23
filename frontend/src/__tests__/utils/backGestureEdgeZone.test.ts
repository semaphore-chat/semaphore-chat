import { describe, it, expect, afterEach } from 'vitest';
import {
  getBackGestureEdgeZone,
  isStandaloneDisplayMode,
  MOBILE_CONSTANTS,
} from '../../utils/breakpoints';

const originalMatchMedia = window.matchMedia;

function mockDisplayMode(standalone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: standalone && query === '(display-mode: standalone)',
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('back-gesture edge zone', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('keeps the edge dead zone in a browser tab (the browser owns edge-back)', () => {
    mockDisplayMode(false);
    expect(isStandaloneDisplayMode()).toBe(false);
    expect(getBackGestureEdgeZone()).toBe(MOBILE_CONSTANTS.EDGE_BACK_GESTURE_ZONE);
  });

  it('drops the edge dead zone in standalone display mode (installed PWA)', () => {
    mockDisplayMode(true);
    expect(isStandaloneDisplayMode()).toBe(true);
    expect(getBackGestureEdgeZone()).toBe(0);
  });

  it('falls back to the dead zone when matchMedia is unavailable', () => {
    // @ts-expect-error simulate an environment without matchMedia
    window.matchMedia = undefined;
    expect(isStandaloneDisplayMode()).toBe(false);
    expect(getBackGestureEdgeZone()).toBe(MOBILE_CONSTANTS.EDGE_BACK_GESTURE_ZONE);
  });
});
