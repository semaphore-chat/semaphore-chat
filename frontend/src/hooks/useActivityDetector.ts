/**
 * Activity detector hook and module-scoped idle state.
 *
 * Tracks user interaction (mouse, keyboard, scroll, touch) and exposes
 * an `isIdle` boolean. After 5 minutes of inactivity the user is
 * considered idle. Switching to a hidden tab sets idle immediately.
 *
 * The module-scoped `getIsIdle()` function lets non-React code
 * (e.g. the socket hub heartbeat) read the current idle state.
 */

import { useEffect } from 'react';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const THROTTLE_MS = 1000; // Throttle activity checks to ~1/sec

let idle = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivity = 0;

export function getIsIdle(): boolean {
  return idle;
}

/** @internal Reset state for testing only */
export function _resetIdleState(): void {
  idle = false;
  lastActivity = 0;
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function startIdleTimer() {
  idle = false;
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    idle = true;
  }, IDLE_TIMEOUT_MS);
}

function resetIdleTimer() {
  const now = Date.now();
  if (now - lastActivity < THROTTLE_MS) return;
  lastActivity = now;
  startIdleTimer();
}

function handleVisibilityChange() {
  if (document.hidden) {
    idle = true;
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  } else {
    // Bypass throttle on visibility change — always reset immediately
    lastActivity = Date.now();
    startIdleTimer();
  }
}

/**
 * Call once at app root to start tracking user activity.
 * Does not cause re-renders — idle state is read imperatively via `getIsIdle()`.
 */
export function useActivityDetector(): void {
  useEffect(() => {
    const events: Array<keyof DocumentEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
    ];

    // Kick off the initial idle timer (bypass throttle to handle remounts)
    lastActivity = Date.now();
    startIdleTimer();

    const handler = () => resetIdleTimer();

    for (const event of events) {
      document.addEventListener(event, handler, { passive: true });
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      for (const event of events) {
        document.removeEventListener(event, handler);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };
  }, []);
}
