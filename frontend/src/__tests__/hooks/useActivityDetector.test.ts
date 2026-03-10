import { renderHook, act } from '@testing-library/react';
import { useActivityDetector, getIsIdle, _resetIdleState } from '../../hooks/useActivityDetector';

describe('useActivityDetector', () => {
  const originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden') ??
    Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')!;

  beforeEach(() => {
    _resetIdleState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetIdleState();
    // Restore original document.hidden descriptor
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, 'hidden', originalHiddenDescriptor);
    }
  });

  it('should not be idle initially', () => {
    renderHook(() => useActivityDetector());
    expect(getIsIdle()).toBe(false);
  });

  it('should become idle after 5 minutes of inactivity', () => {
    renderHook(() => useActivityDetector());

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(getIsIdle()).toBe(true);
  });

  it('should reset idle timer on user activity', () => {
    renderHook(() => useActivityDetector());

    // Advance 4 minutes
    act(() => {
      vi.advanceTimersByTime(4 * 60 * 1000);
    });
    expect(getIsIdle()).toBe(false);

    // Simulate activity (need to advance past throttle)
    act(() => {
      vi.advanceTimersByTime(1001);
      document.dispatchEvent(new Event('mousemove'));
    });

    // Advance another 4 minutes — should NOT be idle because timer was reset
    act(() => {
      vi.advanceTimersByTime(4 * 60 * 1000);
    });
    expect(getIsIdle()).toBe(false);

    // Advance 1 more minute — now should be idle (5 min from last activity)
    act(() => {
      vi.advanceTimersByTime(1 * 60 * 1000);
    });
    expect(getIsIdle()).toBe(true);
  });

  it('should immediately set idle when document becomes hidden', () => {
    renderHook(() => useActivityDetector());
    expect(getIsIdle()).toBe(false);

    act(() => {
      Object.defineProperty(document, 'hidden', {
        value: true,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(getIsIdle()).toBe(true);
  });

  it('should reset idle when document becomes visible again', () => {
    renderHook(() => useActivityDetector());

    // Go hidden
    act(() => {
      Object.defineProperty(document, 'hidden', {
        value: true,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(getIsIdle()).toBe(true);

    // Go visible
    act(() => {
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(getIsIdle()).toBe(false);
  });

  it('should clean up event listeners on unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() => useActivityDetector());

    expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function), { passive: true });
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { passive: true });
    expect(addSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
