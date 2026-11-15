import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardInset } from '../../../kit/layout/useKeyboardInset';
import { fakeVisualViewport } from './visualViewport';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('useKeyboardInset', () => {
  it('is 0 without a visual viewport', () => {
    // @ts-expect-error removed on purpose
    delete window.visualViewport;
    expect(renderHook(() => useKeyboardInset()).result.current).toBe(0);
  });

  it('is 0 while the visual viewport is as tall as the window', () => {
    fakeVisualViewport(800);
    expect(renderHook(() => useKeyboardInset()).result.current).toBe(0);
  });

  it('is the height the keyboard covers, and follows it', () => {
    const viewport = fakeVisualViewport(800);
    const { result } = renderHook(() => useKeyboardInset());
    viewport.cover(300);
    expect(result.current).toBe(300);
    viewport.cover(0);
    expect(result.current).toBe(0);
  });

  it('counts a viewport panned down by the keyboard, so the bottom is the keyboard top', () => {
    const viewport = fakeVisualViewport(800);
    const { result } = renderHook(() => useKeyboardInset());
    viewport.cover(300);
    viewport.set({ offsetTop: 40, height: 460 });
    expect(result.current).toBe(300);
  });

  it('is 0 while the page is pinch-zoomed, which also shrinks the visual viewport', () => {
    const viewport = fakeVisualViewport(800);
    const { result } = renderHook(() => useKeyboardInset());
    viewport.set({ height: 400, scale: 2 });
    expect(result.current).toBe(0);
  });

  it('listens to resize and scroll and removes both listeners on unmount', () => {
    const viewport = fakeVisualViewport(800);
    const { unmount } = renderHook(() => useKeyboardInset());
    expect(viewport.listeners()).toBe(2);
    unmount();
    expect(viewport.listeners()).toBe(0);
  });
});
