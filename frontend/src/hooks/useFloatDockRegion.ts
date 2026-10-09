/**
 * Where the desktop float card may dock: the message column ABOVE the
 * composer, on text views. `MessageContainer` registers its message column
 * and composer here; `FloatCard` reads the resulting rect. Because the
 * column already excludes the member list and the docked side panel
 * (threads / pins / search), docking inside it keeps the card off all of
 * them and off the composer.
 *
 * A single app-wide store (like BottomChromeContext's default store): the
 * card and the message column live far apart in the tree. Elements that
 * measure 0 (hidden screens, jsdom) don't count, so with nothing measurable
 * registered the region is null and the card keeps its window-based
 * placement.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Rect } from '../utils/pipPosition';

export type FloatRegionKind = 'chat' | 'composer';

const elements: Record<FloatRegionKind, Set<HTMLElement>> = { chat: new Set(), composer: new Set() };
const listeners = new Set<() => void>();
let snapshot: Rect | null = null;

const visibleRect = (set: Set<HTMLElement>): DOMRect | null => {
  for (const el of set) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return null;
};

function compute(): Rect | null {
  const chat = visibleRect(elements.chat);
  if (!chat) return null;
  const composer = visibleRect(elements.composer);
  // The composer sits at the bottom of the column; the region ends at its top.
  const bottom = composer && composer.top > chat.top ? Math.min(chat.bottom, composer.top) : chat.bottom;
  return {
    left: Math.round(chat.left),
    top: Math.round(chat.top),
    width: Math.round(chat.width),
    height: Math.round(bottom - chat.top),
  };
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/** Re-measure; notify subscribers only if the region actually changed. */
export function refreshFloatDockRegion(): void {
  const next = compute();
  if (sameRect(next, snapshot)) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('resize', refreshFloatDockRegion);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('resize', refreshFloatDockRegion);
  };
}

const getSnapshot = () => snapshot;

/** The message column above the composer, in window coordinates, or null. */
export function useFloatDockRegion(enabled = true): Rect | null {
  const region = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return enabled ? region : null;
}

/**
 * Callback ref that registers an element as part of the dock region while
 * mounted. `observe` (default) watches its size with its own ResizeObserver;
 * pass false when the owner already measures the element and calls
 * `refreshFloatDockRegion()` itself (the composer: MessageContainer tracks
 * its height for the FABs).
 */
export function useFloatRegionRef(
  kind: FloatRegionKind,
  { observe = true }: { observe?: boolean } = {},
): (el: HTMLElement | null) => void {
  const current = useRef<HTMLElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const detach = useCallback(() => {
    const el = current.current;
    if (!el) return;
    elements[kind].delete(el);
    observerRef.current?.disconnect();
    observerRef.current = null;
    current.current = null;
  }, [kind]);

  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (current.current === el) return;
      detach();
      if (el) {
        current.current = el;
        elements[kind].add(el);
        if (observe && typeof ResizeObserver !== 'undefined') {
          observerRef.current = new ResizeObserver(() => refreshFloatDockRegion());
          observerRef.current.observe(el);
        }
      }
      refreshFloatDockRegion();
    },
    [kind, observe, detach],
  );

  // Unregister on unmount even if React never calls the ref with null.
  useEffect(
    () => () => {
      if (!current.current) return;
      detach();
      refreshFloatDockRegion();
    },
    [detach],
  );

  return ref;
}

/** Tests only: forget every registration. */
export function resetFloatDockRegionForTests(): void {
  elements.chat.clear();
  elements.composer.clear();
  snapshot = null;
}
