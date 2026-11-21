import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useBehaviourHost } from './hostContext';
import type { OverlayHost } from './overlay';

/**
 * The system Back on the web (`design/guide/behaviour.md`, "The system Back"): Android's Back gesture
 * or button, and a browser's Back, close the top layer of the overlay stack before they leave the
 * screen.
 *
 * A browser has no Back event, only history. So every open layer a Back can close (every kind but
 * tooltips) holds one history entry with the same URL, pushed on top of the screen's entry. Its state
 * is the router's state (the router sees the same location and re-routes nothing) plus a marker: the
 * entry ids of the layers open when it was pushed, bottom first. One rule keeps history and the stack
 * together: the current entry's marker lists the open layers. `sync` restores it after any change:
 *
 * - A layer opened: push an entry for it.
 * - A layer closed some other way (Escape, a press outside, its own button): its entry is on top, so
 *   step back over it. No route moves: the entry below has the same URL.
 * - A route replace rewrote the current entry (dropping the marker): push the open layers again.
 *
 * Leaving an entry (`popstate`) is the Back: every open layer the entry landed on does not list is
 * sent one `back` (the topmost first, as the stack decides), each close committed before the next
 * (`flushSync`). A layer whose owner refused stays open, and `sync` pushes its entry again.
 *
 * Entries left under a route (an action in a sheet that navigates pushes the route before the sheet
 * closes) or from before a reload name layers that are not open: landing on one, the bridge steps on
 * over it in the same direction, so a Back never lands on a dead entry.
 *
 * Entry ids carry a token made per bridge, so entries from before a reload or from an earlier bridge
 * never pass for open layers.
 */

/** The history state key of the marker. Not classic's `__overlayStack` (hooks/useOverlayHistory.ts). */
export const SYSTEM_BACK_KEY = '__kitLayers';

export interface SystemBackOptions {
  win: Window;
  overlay: Pick<OverlayHost, 'backLayers' | 'machine'>;
  /** Sends one Back to the stack and commits what it closed before returning. */
  back: () => void;
}

export interface SystemBack {
  /** Restore the rule (on a route change, after a step); coalesced to one run per microtask. */
  schedule(): void;
  /** Restore the rule now. */
  sync(): void;
  dispose(): void;
}

type HistoryState = Record<string, unknown> | null;

function readMarker(state: unknown): string[] {
  const value = (state as HistoryState)?.[SYSTEM_BACK_KEY];
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : [];
}

/** The router's index of an entry (react-router keeps one in `state.idx`), for the direction of a traversal. */
function readIndex(state: unknown): number | null {
  const value = (state as HistoryState)?.idx;
  return typeof value === 'number' ? value : null;
}

export function createSystemBack({ win, overlay, back }: SystemBackOptions): SystemBack {
  const history = win.history;
  const token = Math.random().toString(36).slice(2, 10);
  // Traversals this bridge started whose popstate has not arrived. While one is in flight nothing
  // is pushed: a push now would be the entry the traversal then leaves.
  let inFlight = 0;
  // Stepping over dead entries: the direction to keep going.
  let skipping: -1 | 1 | null = null;
  let lastIndex = readIndex(history.state);
  let scheduled = false;
  let disposed = false;
  // The entry ids of the layers open at the last sync: only their entries are ours to step back over.
  let shown = new Set<string>();

  const live = (): string[] => overlay.backLayers().map((id) => `${token}:${id}`);

  function go(delta: number): void {
    inFlight += 1;
    history.go(delta);
  }

  function sync(): void {
    if (disposed || inFlight > 0) return;
    const marker = readMarker(history.state);
    const open = live();
    let common = 0;
    while (common < marker.length && common < open.length && marker[common] === open[common]) common += 1;
    if (common < marker.length) {
      // Entries on top name layers that closed since the last sync: step back over them. Each entry adds one id
      // to the one below it, so the entry `marker.length - common` back lists exactly the common part.
      if (marker.slice(common).every((id) => shown.has(id))) go(common - marker.length);
      // Otherwise they name layers that closed before: a dead entry the browser has just landed on (its state can
      // change before its popstate is dispatched), which the popstate steps over.
      return;
    }
    for (let i = common; i < open.length; i++) {
      const current = (history.state as HistoryState) ?? {};
      history.pushState({ ...current, [SYSTEM_BACK_KEY]: open.slice(0, i + 1) }, '');
    }
    shown = new Set(open);
    lastIndex = readIndex(history.state);
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      sync();
    });
  }

  function onPopState(event: PopStateEvent): void {
    const index = readIndex(event.state);
    const direction: -1 | 1 = index !== null && lastIndex !== null && index > lastIndex ? 1 : -1;
    lastIndex = index;
    const ours = inFlight > 0;
    if (ours) inFlight -= 1;
    const marker = readMarker(event.state);
    const open = live();
    const openSet = new Set(open);
    if (marker.some((id) => !openSet.has(id))) {
      // A dead entry (left under a route, or from before a reload): on over it, the way we were going.
      const way = skipping ?? (ours ? -1 : direction);
      skipping = way;
      if (inFlight === 0) go(way);
      return;
    }
    skipping = null;
    if (ours) {
      if (inFlight === 0) sync();
      return;
    }
    // The Back: close each open layer this entry does not list, topmost first, one Back each.
    const listed = new Set(marker);
    let missing = open.filter((id) => !listed.has(id)).length;
    while (missing > 0) {
      back();
      const after = live().filter((id) => !listed.has(id)).length;
      // Refused: the owner kept it open. It gets its entry back below.
      if (after >= missing) break;
      missing = after;
    }
    sync();
  }

  // Capture: at the window, capture listeners run before the router's, whose re-render can step the stack.
  win.addEventListener('popstate', onPopState, true);
  const offStack = overlay.machine.subscribe(schedule);
  // Entries left from before a reload (or an earlier bridge) are stepped back over at once.
  const left = readMarker(history.state).length;
  if (left > 0) go(-left);
  else sync();

  return {
    schedule,
    sync,
    dispose() {
      disposed = true;
      offStack();
      win.removeEventListener('popstate', onPopState, true);
    },
  };
}

/**
 * Turns the system Back on for the stack of this host (the Lounge: a touch device, not Electron).
 * `locationKey` is the router's location key: a route change (a replace rewrites the current entry)
 * is checked against the rule too.
 */
export function useSystemBack(enabled: boolean, locationKey: string): void {
  const { overlay } = useBehaviourHost();
  const [bridge, setBridge] = useState<SystemBack | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const created = createSystemBack({
      win: window,
      overlay,
      // Committed at once: the stack must know whether the owner closed or refused before the
      // bridge decides which entries to keep.
      back: () => flushSync(() => overlay.back()),
    });
    setBridge(created);
    return () => {
      created.dispose();
      setBridge(null);
    };
  }, [enabled, overlay]);
  useEffect(() => {
    bridge?.schedule();
  }, [bridge, locationKey]);
}
