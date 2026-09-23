/**
 * useSwipeGesture Hook
 *
 * Enhanced swipe gesture handling with edge detection,
 * progress callbacks, and velocity tracking.
 */

import { useRef, useEffect, useState, TouchEvent, useCallback } from 'react';
import { MOBILE_CONSTANTS } from '../utils/breakpoints';
import { useHapticFeedback } from './useHapticFeedback';

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

interface TouchPosition {
  x: number;
  y: number;
  time: number;
}

interface SwipeGestureOptions {
  // Direction callbacks
  onSwipe?: (direction: SwipeDirection, velocity: number) => void;
  onSwipeLeft?: (velocity: number) => void;
  onSwipeRight?: (velocity: number) => void;
  onSwipeUp?: (velocity: number) => void;
  onSwipeDown?: (velocity: number) => void;

  // Progress callback, called on every touchmove with the live deltas so the
  // UI can follow the finger. Not called for gestures that are exempt or that
  // started in an ignored edge zone.
  onProgress?: (deltaX: number, deltaY: number, progress: number) => void;
  // Called once when a gesture ends (touchend or touchcancel) with the swipe
  // direction that was committed, or null when it didn't commit. Pair with
  // onProgress to reset or settle a drag-following transform.
  onSwipeEnd?: (direction: SwipeDirection | null) => void;

  // Edge swipe detection
  onEdgeSwipeStart?: (edge: 'left' | 'right') => void;
  edgeZone?: number; // Pixels from edge to detect edge swipe (0 = no edge zone)
  // When true, a swipe that STARTS within `edgeZone` of the left/right edge is
  // ignored entirely (no directional callbacks fire). Used to avoid fighting the
  // browser's native edge back-gesture.
  ignoreEdgeSwipes?: boolean;

  // Return true to skip a gesture entirely based on where it started (e.g. it
  // began inside horizontally scrollable content or a text input). Evaluated
  // once on touch start against the event target.
  isExempt?: (target: EventTarget | null) => boolean;

  // Configuration
  threshold?: number; // Minimum distance for swipe
  velocityThreshold?: number; // Minimum velocity (px/ms)
  // How strongly one axis must dominate the other for the gesture to count as
  // that axis. e.g. 1.5 means horizontal displacement must exceed 1.5x the
  // vertical displacement before a left/right swipe registers — this keeps
  // ordinary vertical scrolling from triggering navigation.
  directionRatio?: number;
  enabled?: boolean;
}

interface SwipeState {
  startedFromEdge: 'left' | 'right' | null;
  isSwiping: boolean;
  isExempt: boolean;
}

/**
 * Hook for handling swipe gestures on mobile
 */
export const useSwipeGesture = (options: SwipeGestureOptions = {}) => {
  const {
    onSwipe,
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    onProgress,
    onSwipeEnd,
    onEdgeSwipeStart,
    edgeZone = MOBILE_CONSTANTS.EDGE_SWIPE_ZONE,
    ignoreEdgeSwipes = false,
    isExempt,
    threshold = MOBILE_CONSTANTS.SWIPE_THRESHOLD,
    velocityThreshold = 0.3, // px/ms
    directionRatio = 1,
    enabled = true,
  } = options;

  const touchStart = useRef<TouchPosition | null>(null);
  const touchEnd = useRef<TouchPosition | null>(null);
  const swipeState = useRef<SwipeState>({
    startedFromEdge: null,
    isSwiping: false,
    isExempt: false,
  });

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled) return;

    const touch = e.targetTouches[0];
    const screenWidth = window.innerWidth;

    touchEnd.current = null;
    touchStart.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };

    // Detect edge swipe
    let edge: 'left' | 'right' | null = null;
    if (edgeZone > 0) {
      if (touch.clientX <= edgeZone) {
        edge = 'left';
      } else if (touch.clientX >= screenWidth - edgeZone) {
        edge = 'right';
      }
    }

    swipeState.current = {
      startedFromEdge: edge,
      isSwiping: false,
      // Evaluate exemption once, against the element the gesture started on.
      isExempt: isExempt ? isExempt(e.target) : false,
    };

    if (edge && onEdgeSwipeStart) {
      onEdgeSwipeStart(edge);
    }
  }, [enabled, edgeZone, isExempt, onEdgeSwipeStart]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || !touchStart.current) return;

    const touch = e.targetTouches[0];
    touchEnd.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };

    const deltaX = touchEnd.current.x - touchStart.current.x;
    const deltaY = touchEnd.current.y - touchStart.current.y;

    // Calculate progress (0 to 1) based on threshold
    const absX = Math.abs(deltaX);
    const progress = Math.min(absX / threshold, 1);

    // Mark as swiping if we've moved past a small distance
    if (absX > 10 || Math.abs(deltaY) > 10) {
      swipeState.current.isSwiping = true;
    }

    // Report live progress, unless this gesture will be ignored at touchend
    // anyway (exempt content, or the browser's edge back-gesture zone).
    const { isExempt: gestureExempt, startedFromEdge } = swipeState.current;
    if (onProgress && !gestureExempt && !(ignoreEdgeSwipes && startedFromEdge)) {
      onProgress(deltaX, deltaY, progress);
    }
  }, [enabled, threshold, onProgress, ignoreEdgeSwipes]);

  const resetGesture = useCallback(() => {
    touchStart.current = null;
    touchEnd.current = null;
    swipeState.current = { startedFromEdge: null, isSwiping: false, isExempt: false };
  }, []);

  const handleTouchEnd = useCallback(() => {
    const { startedFromEdge, isExempt: gestureExempt } = swipeState.current;

    // No active gesture (never started, disabled, or already cancelled).
    if (!touchStart.current) {
      resetGesture();
      return;
    }

    if (!enabled || !touchEnd.current) {
      resetGesture();
      onSwipeEnd?.(null);
      return;
    }

    // Bail if the gesture started on exempt content, or (when configured) within
    // the edge back-gesture zone — no directional callbacks fire.
    if (gestureExempt || (ignoreEdgeSwipes && startedFromEdge)) {
      resetGesture();
      onSwipeEnd?.(null);
      return;
    }

    const deltaX = touchEnd.current.x - touchStart.current.x;
    const deltaY = touchEnd.current.y - touchStart.current.y;
    const deltaTime = touchEnd.current.time - touchStart.current.time;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Determine swipe direction. One axis must clearly dominate the other
    // (`directionRatio`) so vertical scrolling never registers as horizontal.
    let direction: SwipeDirection | null = null;

    const isHorizontalIntent = absX > absY * directionRatio;
    const isVerticalIntent = absY > absX * directionRatio;

    // Register a swipe when the dominant-axis distance exceeds the threshold, OR
    // the dominant-axis velocity exceeds its threshold (fast flick, even if short).
    if (isHorizontalIntent) {
      const axisVelocity = absX / (deltaTime || 1);
      if (absX > threshold || axisVelocity > velocityThreshold) {
        direction = deltaX > 0 ? 'right' : 'left';
      }
    } else if (isVerticalIntent) {
      const axisVelocity = absY / (deltaTime || 1);
      if (absY > threshold || axisVelocity > velocityThreshold) {
        direction = deltaY > 0 ? 'down' : 'up';
      }
    }

    const velocity = (absX > absY ? absX : absY) / (deltaTime || 1);

    if (direction) {
      onSwipe?.(direction, velocity);

      switch (direction) {
        case 'left':
          onSwipeLeft?.(velocity);
          break;
        case 'right':
          onSwipeRight?.(velocity);
          break;
        case 'up':
          onSwipeUp?.(velocity);
          break;
        case 'down':
          onSwipeDown?.(velocity);
          break;
      }
    }

    resetGesture();
    onSwipeEnd?.(direction);
  }, [enabled, threshold, velocityThreshold, directionRatio, ignoreEdgeSwipes, onSwipe, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, onSwipeEnd, resetGesture]);

  // The system took the touch (scroll, call, multi-touch): end the gesture
  // without firing a swipe.
  const handleTouchCancel = useCallback(() => {
    const wasActive = !!touchStart.current;
    resetGesture();
    if (wasActive) onSwipeEnd?.(null);
  }, [onSwipeEnd, resetGesture]);

  // Getter for current swipe state
  const getSwipeState = useCallback(() => ({
    ...swipeState.current,
    touchStart: touchStart.current,
    touchEnd: touchEnd.current,
  }), []);

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchCancel,
    getSwipeState,
  };
};

export interface LongPressPoint {
  x: number;
  y: number;
}

const INTERACTIVE_TARGET_SELECTOR = 'a, button, input, textarea, select, [role="button"]';

/**
 * Extract the pointer coordinates from a touch or mouse event.
 */
const getEventPoint = (e: TouchEvent | React.MouseEvent): LongPressPoint | null => {
  if ('touches' in e) {
    const touch = e.touches[0] ?? e.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return { x: e.clientX, y: e.clientY };
};

/**
 * Whether the gesture started on a *nested* interactive element (link, button,
 * input, etc.) — one below the element the long-press is bound to. The bound
 * element itself is allowed even if it is a button/role=button (e.g. a
 * ListItemButton row), so long-press still works while nested controls keep
 * their own behavior.
 */
const startedOnInteractiveElement = (
  target: EventTarget | null,
  currentTarget: EventTarget | null,
): boolean => {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(INTERACTIVE_TARGET_SELECTOR);
  return !!interactive && interactive !== currentTarget;
};

/**
 * Hook for handling long press gestures.
 *
 * Fires `onLongPress` (with the originating point) after `delay` ms of a
 * stationary press. Movement beyond the slop threshold, an early release, or a
 * press that begins on an interactive element all cancel the gesture. Also
 * returns an `onContextMenu` handler consumers can attach to suppress the
 * browser's native context menu / iOS callout right after a long-press fires.
 */
export const useLongPress = (
  onLongPress: (point: LongPressPoint | null) => void,
  options: {
    delay?: number;
    enabled?: boolean;
    slop?: number;
    onPressStart?: () => void;
    onPressEnd?: () => void;
  } = {}
) => {
  const {
    delay = MOBILE_CONSTANTS.LONG_PRESS_DURATION,
    enabled = true,
    slop = MOBILE_CONSTANTS.LONG_PRESS_SLOP,
    onPressStart,
    onPressEnd,
  } = options;

  const haptics = useHapticFeedback();
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isLongPressTriggered = useRef(false);
  const startPoint = useRef<LongPressPoint | null>(null);

  const clearTimer = useCallback(() => {
    if (timeout.current) {
      clearTimeout(timeout.current);
      timeout.current = undefined;
    }
  }, []);

  const start = useCallback((e: TouchEvent | React.MouseEvent) => {
    if (!enabled) return;
    if (startedOnInteractiveElement(e.target, e.currentTarget)) return;

    isLongPressTriggered.current = false;
    startPoint.current = getEventPoint(e);
    onPressStart?.();

    timeout.current = setTimeout(() => {
      isLongPressTriggered.current = true;
      haptics.longPress();
      onLongPress(startPoint.current);
    }, delay);
  }, [enabled, delay, onLongPress, onPressStart, haptics]);

  const move = useCallback((e: TouchEvent | React.MouseEvent) => {
    if (!timeout.current || !startPoint.current) return;

    const point = getEventPoint(e);
    if (!point) return;

    const dx = Math.abs(point.x - startPoint.current.x);
    const dy = Math.abs(point.y - startPoint.current.y);
    if (dx > slop || dy > slop) {
      clearTimer();
    }
  }, [slop, clearTimer]);

  const cancel = useCallback(() => {
    clearTimer();
    startPoint.current = null;
    onPressEnd?.();
  }, [clearTimer, onPressEnd]);

  // Suppress the native context menu / iOS callout that fires immediately after
  // a long-press. Only preventDefault when our long-press just fired so a real
  // desktop right-click still passes through (right-click's mousedown runs
  // start(), which clears the flag before contextmenu fires). The flag is NOT
  // reset here: browsers that skip the synthetic contextmenu (iOS) still fire
  // a ghost click afterwards, and consumers guard their onClick by reading
  // isLongPressTriggered(). It resets at the start of the next press.
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (isLongPressTriggered.current) {
      e.preventDefault();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timeout.current) {
        clearTimeout(timeout.current);
      }
    };
  }, []);

  return {
    onMouseDown: start,
    onMouseMove: move,
    onMouseUp: cancel,
    onMouseLeave: cancel,
    onTouchStart: start,
    onTouchMove: move,
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onContextMenu,
    isLongPressTriggered: () => isLongPressTriggered.current,
  };
};

/**
 * Hook for pull-to-refresh gesture.
 *
 * Triggers `onRefresh` when the user drags down past `threshold` while scrolled
 * to the top. Exposes reactive `isRefreshing` / `pullDistance` state so a small
 * indicator can be rendered. Pass `scrollElementRef` when the scrollable region
 * is an inner element rather than the document (the common case for app panels)
 * — otherwise the top check reads the document scroll position.
 */
export const usePullToRefresh = (
  onRefresh: () => Promise<void>,
  options: {
    threshold?: number;
    enabled?: boolean;
    scrollElementRef?: React.RefObject<HTMLElement | null>;
    /**
     * Whether to publish `pullDistance`/`pullProgress` as React state.
     * Defaults to true; pass false when the consumer only reads
     * `isRefreshing` — otherwise every touchmove re-renders it.
     */
    trackPullDistance?: boolean;
  } = {}
) => {
  const {
    threshold = 80,
    enabled = true,
    scrollElementRef,
    trackPullDistance = true,
  } = options;

  // null = no active pull. (Storing 0 would be ambiguous with a pull that
  // starts at clientY === 0.)
  const touchStart = useRef<number | null>(null);
  const pullDistanceRef = useRef<number>(0);
  const isRefreshingRef = useRef<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  const getScrollTop = useCallback((): number => {
    if (scrollElementRef?.current) return scrollElementRef.current.scrollTop;
    return document.documentElement.scrollTop || document.body.scrollTop;
  }, [scrollElementRef]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    // Always start clean — a previous gesture may have left pull distance
    // behind (e.g. it ended outside the element and touchend never fired).
    pullDistanceRef.current = 0;
    if (trackPullDistance) setPullDistance(0);

    if (!enabled || isRefreshingRef.current) {
      touchStart.current = null;
      return;
    }

    // Only begin a pull when scrolled to the very top of the scroll region.
    if (getScrollTop() > 0) {
      touchStart.current = null;
      return;
    }

    touchStart.current = e.touches[0].clientY;
  }, [enabled, getScrollTop, trackPullDistance]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || isRefreshingRef.current || touchStart.current === null) return;

    const touchY = e.touches[0].clientY;
    const distance = Math.max(0, touchY - touchStart.current);
    pullDistanceRef.current = distance;
    if (trackPullDistance) setPullDistance(distance);
  }, [enabled, trackPullDistance]);

  const handleTouchEnd = useCallback(async () => {
    // No active pull (rejected at touchstart or already consumed) — nothing
    // to evaluate, but make sure no stale distance lingers.
    const hadActivePull = touchStart.current !== null;
    touchStart.current = null;

    const shouldRefresh =
      hadActivePull &&
      enabled &&
      !isRefreshingRef.current &&
      pullDistanceRef.current >= threshold;

    pullDistanceRef.current = 0;
    if (trackPullDistance) setPullDistance(0);

    if (shouldRefresh) {
      isRefreshingRef.current = true;
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        isRefreshingRef.current = false;
        setIsRefreshing(false);
      }
    }
  }, [enabled, threshold, onRefresh, trackPullDistance]);

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    isRefreshing,
    pullDistance,
    pullProgress: Math.min(pullDistance / threshold, 1),
  };
};
