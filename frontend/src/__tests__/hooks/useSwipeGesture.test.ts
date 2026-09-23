import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSwipeGesture } from '../../hooks/useSwipeGesture';

/** Build a touch-like event accepted by the swipe handlers. */
function touch(x: number, y: number, target: EventTarget = document.createElement('div')) {
  const point = { clientX: x, clientY: y };
  return {
    target,
    targetTouches: [point],
    touches: [point],
    changedTouches: [point],
  } as unknown as React.TouchEvent;
}

function swipe(
  result: { current: ReturnType<typeof useSwipeGesture> },
  from: [number, number],
  to: [number, number],
  target?: EventTarget,
) {
  act(() => result.current.onTouchStart(touch(from[0], from[1], target)));
  act(() => result.current.onTouchMove(touch(to[0], to[1], target)));
  act(() => result.current.onTouchEnd());
}

describe('useSwipeGesture', () => {
  // jsdom default innerWidth is 1024; edges are near 0 and near 1024.

  it('fires onSwipeRight for a clear rightward drag', () => {
    const onSwipeRight = vi.fn();
    const onSwipeLeft = vi.fn();
    const { result } = renderHook(() =>
      useSwipeGesture({ onSwipeRight, onSwipeLeft, directionRatio: 1.5 }),
    );

    swipe(result, [200, 100], [360, 100]);

    expect(onSwipeRight).toHaveBeenCalledTimes(1);
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('fires onSwipeLeft for a clear leftward drag', () => {
    const onSwipeRight = vi.fn();
    const onSwipeLeft = vi.fn();
    const { result } = renderHook(() =>
      useSwipeGesture({ onSwipeRight, onSwipeLeft, directionRatio: 1.5 }),
    );

    swipe(result, [360, 100], [200, 100]);

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('does not fire horizontal callbacks for a mostly-vertical drag (scroll)', () => {
    const onSwipeRight = vi.fn();
    const onSwipeLeft = vi.fn();
    const onSwipeDown = vi.fn();
    const { result } = renderHook(() =>
      useSwipeGesture({ onSwipeRight, onSwipeLeft, onSwipeDown, directionRatio: 1.5 }),
    );

    // Large vertical, small horizontal — must not register as left/right.
    swipe(result, [200, 100], [215, 320]);

    expect(onSwipeRight).not.toHaveBeenCalled();
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeDown).toHaveBeenCalledTimes(1);
  });

  it('ignores a swipe that starts within the edge zone when ignoreEdgeSwipes is set', () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() =>
      useSwipeGesture({ onSwipeRight, ignoreEdgeSwipes: true, edgeZone: 24, directionRatio: 1.5 }),
    );

    // Starts at x=10 (< 24px from left edge) → ignored.
    swipe(result, [10, 100], [250, 100]);

    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('still fires when ignoreEdgeSwipes is off even if started near the edge', () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() =>
      useSwipeGesture({ onSwipeRight, ignoreEdgeSwipes: false, edgeZone: 24, directionRatio: 1.5 }),
    );

    swipe(result, [10, 100], [250, 100]);

    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it('ignores a swipe that starts on an exempt element', () => {
    const onSwipeRight = vi.fn();
    const exemptEl = document.createElement('pre');
    const { result } = renderHook(() =>
      useSwipeGesture({
        onSwipeRight,
        directionRatio: 1.5,
        isExempt: (t) => t instanceof Element && !!t.closest('pre'),
      }),
    );

    swipe(result, [200, 100], [360, 100], exemptEl);

    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() =>
      useSwipeGesture({ onSwipeRight, enabled: false }),
    );

    swipe(result, [200, 100], [360, 100]);

    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  describe('live progress (drag-following)', () => {
    it('reports the live horizontal delta on every move', () => {
      const onProgress = vi.fn();
      const { result } = renderHook(() => useSwipeGesture({ onProgress, threshold: 50 }));

      act(() => result.current.onTouchStart(touch(200, 100)));
      act(() => result.current.onTouchMove(touch(230, 102)));
      act(() => result.current.onTouchMove(touch(300, 104)));

      expect(onProgress).toHaveBeenNthCalledWith(1, 30, 2, 0.6);
      expect(onProgress).toHaveBeenNthCalledWith(2, 100, 4, 1);
    });

    it('does not report progress for a gesture that started in the ignored edge zone', () => {
      const onProgress = vi.fn();
      const { result } = renderHook(() =>
        useSwipeGesture({ onProgress, ignoreEdgeSwipes: true, edgeZone: 24 }),
      );

      act(() => result.current.onTouchStart(touch(10, 100)));
      act(() => result.current.onTouchMove(touch(150, 100)));

      expect(onProgress).not.toHaveBeenCalled();
    });

    it('does not report progress for a gesture that started on exempt content', () => {
      const onProgress = vi.fn();
      const { result } = renderHook(() =>
        useSwipeGesture({ onProgress, isExempt: () => true }),
      );

      act(() => result.current.onTouchStart(touch(200, 100)));
      act(() => result.current.onTouchMove(touch(300, 100)));

      expect(onProgress).not.toHaveBeenCalled();
    });

    it('calls onSwipeEnd with the committed direction', () => {
      const onSwipeEnd = vi.fn();
      const { result } = renderHook(() =>
        useSwipeGesture({ onSwipeEnd, directionRatio: 1.5 }),
      );

      swipe(result, [200, 100], [360, 100]);

      expect(onSwipeEnd).toHaveBeenCalledWith('right');
    });

    it('calls onSwipeEnd with null when the drag does not commit', () => {
      const onSwipeEnd = vi.fn();
      const onSwipeRight = vi.fn();
      const nowSpy = vi.spyOn(Date, 'now');
      nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(1000);
      const { result } = renderHook(() =>
        useSwipeGesture({ onSwipeEnd, onSwipeRight, threshold: 50 }),
      );

      // Short, slow drag: below both distance and velocity thresholds.
      swipe(result, [200, 100], [220, 100]);
      nowSpy.mockRestore();

      expect(onSwipeRight).not.toHaveBeenCalled();
      expect(onSwipeEnd).toHaveBeenCalledWith(null);
    });

    it('touch cancel ends the gesture without firing a swipe', () => {
      const onSwipeEnd = vi.fn();
      const onSwipeRight = vi.fn();
      const { result } = renderHook(() => useSwipeGesture({ onSwipeEnd, onSwipeRight }));

      act(() => result.current.onTouchStart(touch(200, 100)));
      act(() => result.current.onTouchMove(touch(360, 100)));
      act(() => result.current.onTouchCancel());
      act(() => result.current.onTouchEnd());

      expect(onSwipeRight).not.toHaveBeenCalled();
      expect(onSwipeEnd).toHaveBeenCalledTimes(1);
      expect(onSwipeEnd).toHaveBeenCalledWith(null);
    });

    it('treats an edge zone of 0 as "no edge zone" (standalone PWA)', () => {
      const onSwipeRight = vi.fn();
      const onProgress = vi.fn();
      const { result } = renderHook(() =>
        useSwipeGesture({ onSwipeRight, onProgress, ignoreEdgeSwipes: true, edgeZone: 0 }),
      );

      swipe(result, [0, 100], [200, 100]);

      expect(onProgress).toHaveBeenCalled();
      expect(onSwipeRight).toHaveBeenCalledTimes(1);
    });
  });
});
