/**
 * useOverlayHistory
 *
 * Makes hardware/browser "back" close an overlay (drawer, full-screen thread,
 * bottom sheet) before it leaves the screen.
 *
 * While `open` is true the hook adds one history entry with the same URL. Its
 * state is the router's current state plus an `__overlayStack` marker listing
 * the open overlays, so react-router sees the same location (same `idx`/`key`)
 * and nothing re-routes. Pressing back pops that entry; the resulting
 * `popstate` calls `onClose` for every overlay missing from the new stack.
 *
 * Closing the overlay any other way (close button, backdrop, action) removes
 * its entry again with `history.back()`, but only when that entry is still
 * the current one. If a route navigation was pushed on top of it, we leave
 * history alone rather than undo the navigation.
 *
 * `history.back()` is asynchronous, so a push requested while a back is still
 * in flight (sheet closes → thread opens in the same tick) is queued until
 * the `popstate` for that back has arrived.
 */
import { useEffect, useId, useRef } from 'react';

const STACK_KEY = '__overlayStack';

type HistoryState = Record<string, unknown> | null;

interface Subscriber {
  id: string;
  onPopClose: () => void;
}

const subscribers = new Map<string, Subscriber>();
let pendingBacks = 0;
let queuedPushes: Array<{ id: string; run: () => void }> = [];
let listening = false;

function readStack(state: unknown = window.history.state): string[] {
  const value = (state as HistoryState)?.[STACK_KEY];
  return Array.isArray(value) ? (value as string[]) : [];
}

function doPush(id: string) {
  const current = (window.history.state as HistoryState) ?? {};
  const stack = readStack(current);
  if (stack.includes(id)) return;
  window.history.pushState({ ...current, [STACK_KEY]: [...stack, id] }, '');
}

function handlePopState(event: PopStateEvent) {
  if (pendingBacks > 0) {
    pendingBacks -= 1;
  }

  const stack = readStack(event.state);
  const queuedIds = new Set(queuedPushes.map((q) => q.id));
  for (const sub of Array.from(subscribers.values())) {
    // Queued overlays haven't pushed their entry yet — they aren't affected.
    if (!stack.includes(sub.id) && !queuedIds.has(sub.id)) {
      subscribers.delete(sub.id);
      sub.onPopClose();
    }
  }

  if (pendingBacks === 0 && queuedPushes.length > 0) {
    const toRun = queuedPushes;
    queuedPushes = [];
    toRun.forEach((q) => q.run());
  }
}

function ensureListener() {
  if (listening || typeof window === 'undefined') return;
  window.addEventListener('popstate', handlePopState);
  listening = true;
}

function pushOverlay(id: string) {
  const run = () => {
    // Might have been closed while queued.
    if (subscribers.has(id)) doPush(id);
  };
  if (pendingBacks > 0) {
    queuedPushes.push({ id, run });
  } else {
    run();
  }
}

function releaseOverlay(id: string) {
  subscribers.delete(id);
  const queuedIndex = queuedPushes.findIndex((q) => q.id === id);
  if (queuedIndex !== -1) {
    queuedPushes.splice(queuedIndex, 1);
    return;
  }
  const stack = readStack();
  if (stack[stack.length - 1] === id) {
    pendingBacks += 1;
    window.history.back();
  }
}

export interface UseOverlayHistoryOptions {
  /** When false the hook does nothing (e.g. desktop layouts). Default true. */
  enabled?: boolean;
}

export function useOverlayHistory(
  open: boolean,
  onClose: () => void,
  options: UseOverlayHistoryOptions = {},
): void {
  const { enabled = true } = options;
  const reactId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const active = enabled && open;

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    ensureListener();
    // A fresh id per open, so a stale popstate can never close a reopened overlay.
    const id = `${reactId}:${Math.random().toString(36).slice(2, 8)}`;
    subscribers.set(id, { id, onPopClose: () => onCloseRef.current() });
    pushOverlay(id);
    return () => {
      // Still subscribed → closed from the UI (or unmounted): drop our entry.
      if (subscribers.has(id)) releaseOverlay(id);
    };
  }, [active, reactId]);
}

export default useOverlayHistory;
