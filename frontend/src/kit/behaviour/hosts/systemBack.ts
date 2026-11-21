import { useCallback, useEffect, useRef, useState } from 'react';
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
 * - A layer closed and another opened together (a menu item that opens a sheet): the top entry's
 *   marker is rewritten in place. No traversal, no new entry.
 * - A route replace rewrote the top layer entry (a pinned jump, a `?highlight=` clean-up): step back
 *   to the screen's own entry and put the replaced state and URL there, so the screen keeps one entry
 *   (else a Back, and the header's back arrow, would land on the old screen entry and seem dead).
 *
 * Leaving an entry (`popstate`) is the Back: every open layer the entry landed on does not list is
 * sent one `back` (the topmost first, as the stack decides), each close committed before the next
 * (`flushSync`). A layer whose owner refused stays open, and the bridge goes forward again onto the
 * entry just left instead of pushing a new one: Chrome's Back button skips entries pushed without a
 * user gesture, and one pushed right after a traversal has none.
 *
 * Entries left under a route (an action in a sheet that navigates pushes the route before the sheet
 * closes) or from before a reload name layers that are not open: landing on one, the bridge steps on
 * over it in the direction the user went, so neither Back nor Forward lands on a dead entry.
 *
 * The bridge's own traversals between entries of the same URL are hidden from the router (its popstate
 * listener runs first, in the capture phase, and stops the event): there is nothing for it to route.
 *
 * Entry ids carry a token made per bridge, so entries from before a reload or from an earlier bridge
 * never pass for open layers.
 */

/** The history state key of the marker. Not classic's `__overlayStack` (hooks/useOverlayHistory.ts). */
export const SYSTEM_BACK_KEY = '__kitLayers';

/** A traversal of the bridge's own that has not produced its popstate by then is taken as lost. */
export const TRAVERSAL_TIMEOUT_MS = 1000;

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
  /**
   * Runs `run` (a navigation) once the entries of layers that just closed have been stepped back over, so a
   * route pushed or replaced from inside a closing layer lands on the screen's own entry, not the layer's.
   */
  afterEntries(run: () => void): void;
  dispose(): void;
}

type HistoryState = Record<string, unknown> | null;

function readMarker(state: unknown): string[] {
  const value = (state as HistoryState)?.[SYSTEM_BACK_KEY];
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : [];
}

/** The router's index of an entry (react-router keeps one in `state.idx`, when it made the entry). */
function readIndex(state: unknown): number | null {
  const value = (state as HistoryState)?.idx;
  return typeof value === 'number' ? value : null;
}

/** An entry's state without the marker, as text: the screen's entry and its layer entries all read the same. */
function baseOf(state: unknown): string {
  return JSON.stringify(withoutMarker(state) ?? {});
}

/**
 * Where an entry sits in history, for the direction of a traversal: the router's index, then the
 * marker's length. A layer entry copies the screen's index and sits right above it, one id deeper per
 * entry, so the pair orders every entry (it is the sequence number of the entry within its route).
 */
type Position = readonly [number, number];
function positionOf(state: unknown): Position {
  return [readIndex(state) ?? -1, readMarker(state).length];
}
function compare(a: Position, b: Position): number {
  return a[0] - b[0] || a[1] - b[1];
}

function withoutMarker(state: unknown): HistoryState {
  if (state === null || typeof state !== 'object') return state as HistoryState;
  const { [SYSTEM_BACK_KEY]: _marker, ...rest } = state as Record<string, unknown>;
  return rest;
}

interface Pending {
  /** Hide the popstate from the router when the traversal lands on this URL. */
  hideAt: string;
  /** Run on landing instead of a plain `sync`. */
  onLand?: () => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createSystemBack({ win, overlay, back }: SystemBackOptions): SystemBack {
  const history = win.history;
  const token = Math.random().toString(36).slice(2, 10);
  // The bridge's own traversal whose popstate has not arrived. While one is in flight nothing is
  // pushed: a push now would be the entry the traversal then leaves.
  let pending: Pending | null = null;
  // Stepping over dead entries: the direction to keep going.
  let skipping: -1 | 1 | null = null;
  let lastPosition = positionOf(history.state);
  // What the last sync left: the open layers (the top entry's marker), the entry's state without the marker,
  // its URL and the length of history.
  let shownChain: string[] = [];
  let lastBase = baseOf(history.state);
  let lastHref = win.location.href;
  let lastLength = history.length;
  let scheduled = false;
  let disposed = false;
  // Navigations waiting for a traversal of the bridge's own to land.
  let waiting: Array<() => void> = [];

  function flushWaiting(): void {
    if (pending !== null) return;
    const runs = waiting;
    waiting = [];
    runs.forEach((run) => run());
  }

  const live = (): string[] => overlay.backLayers().map((id) => `${token}:${id}`);
  const ours = (id: string) => id.startsWith(`${token}:`);

  function go(delta: number, onLand?: () => void, hideAt: string = win.location.href): void {
    const timer = setTimeout(() => {
      if (pending?.timer !== timer) return;
      // No popstate came (there was no entry that far): nothing is in flight any more.
      pending = null;
      if (skipping === 1) {
        // Forward past a dead entry, with nothing after it: back over it instead.
        skipping = -1;
        go(-1);
        return;
      }
      skipping = null;
      sync();
      flushWaiting();
    }, TRAVERSAL_TIMEOUT_MS);
    pending = { hideAt, onLand, timer };
    history.go(delta);
  }

  function record(open: string[]): void {
    shownChain = open;
    lastBase = baseOf(history.state);
    lastHref = win.location.href;
    lastLength = history.length;
    lastPosition = positionOf(history.state);
  }

  function sync(): void {
    if (disposed || pending !== null) return;
    const state = history.state as HistoryState;
    const marker = readMarker(state);
    const open = live();

    // A route replace rewrote the top layer entry: its marker went, its state is not the screen's (a traversal
    // to the screen's entry would read the same as before), and history did not grow (a push would).
    if (shownChain.length > 0 && marker.length === 0 && history.length === lastLength && baseOf(state) !== lastBase) {
      const replaced = state;
      const replacedHref = win.location.href;
      go(
        -shownChain.length,
        () => {
          // On the screen's own entry: it becomes the replaced one, and the layers still open get theirs again.
          history.replaceState(replaced, '', replacedHref);
          shownChain = [];
          sync();
        },
        lastHref,
      );
      return;
    }

    let common = 0;
    while (common < marker.length && common < open.length && marker[common] === open[common]) common += 1;
    if (common < marker.length) {
      const gone = marker.slice(common);
      // Entries naming layers that closed before the last sync: a dead entry the browser has just landed on
      // (its state can change before its popstate is dispatched), which the popstate steps over.
      if (!gone.every((id) => shownChain.includes(id))) return;
      if (gone.length === 1 && open.length > common) {
        // One closed, others opened: the top entry takes the new marker; the rest are pushed on it.
        history.replaceState({ ...state, [SYSTEM_BACK_KEY]: open.slice(0, common + 1) }, '');
        common += 1;
      } else {
        // Entries on top name layers that closed since the last sync: step back over them. Each entry adds one
        // id to the one below it, so the entry `gone.length` back lists exactly the common part.
        go(-gone.length);
        return;
      }
    }
    for (let i = common; i < open.length; i++) {
      const current = (history.state as HistoryState) ?? {};
      history.pushState({ ...current, [SYSTEM_BACK_KEY]: open.slice(0, i + 1) }, '');
    }
    record(open);
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
    const position = positionOf(event.state);
    const direction: -1 | 1 = compare(position, lastPosition) > 0 ? 1 : -1;
    lastPosition = position;
    const own = pending;
    if (own !== null) {
      clearTimeout(own.timer);
      pending = null;
      // Between entries of the same URL there is nothing for the router to do.
      if (win.location.href === own.hideAt) event.stopImmediatePropagation();
    }
    const marker = readMarker(event.state);
    const open = live();
    if (marker.some((id) => !open.includes(id))) {
      // A dead entry (left under a route, or from before a reload): on over it, the way the user went.
      const way = skipping ?? (own !== null ? -1 : direction);
      skipping = way;
      go(way);
      return;
    }
    skipping = null;
    if (own !== null) {
      if (own.onLand) own.onLand();
      else sync();
      flushWaiting();
      return;
    }
    // The Back: close each open layer this entry does not list, topmost first, one Back each.
    let missing = open.filter((id) => !marker.includes(id)).length;
    while (missing > 0) {
      back();
      const after = live().filter((id) => !marker.includes(id)).length;
      if (after >= missing) break;
      missing = after;
    }
    if (missing > 0) {
      // Refused: forward again onto the entry just left (it still lists the layers still open), not a new push.
      go(missing);
      return;
    }
    sync();
  }

  // Capture: at the window, capture listeners run before the router's, whose re-render can step the stack,
  // and only from here can the bridge hide its own traversals from the router.
  win.addEventListener('popstate', onPopState, true);
  const offStack = overlay.machine.subscribe(schedule);

  // Entries left from before a reload (or an earlier bridge) are stepped back over at once. The marker is taken
  // off the current entry first, so a second bridge made right after (StrictMode mounts twice) sees none.
  const left = readMarker(history.state).length;
  if (left > 0) {
    history.replaceState(withoutMarker(history.state), '');
    go(-left);
  } else {
    sync();
  }

  return {
    schedule,
    sync,
    afterEntries(run) {
      // After the stack's pending changes have been synced (a layer closed in this commit is gone by the microtask).
      queueMicrotask(() => {
        sync();
        if (pending === null) run();
        else waiting.push(run);
      });
    },
    dispose() {
      disposed = true;
      if (pending !== null) clearTimeout(pending.timer);
      pending = null;
      offStack();
      win.removeEventListener('popstate', onPopState, true);
      const runs = waiting;
      waiting = [];
      runs.forEach((run) => run());
      // Layers still open keep no entries of a bridge that is gone: step back over them.
      const marker = readMarker(history.state);
      if (marker.length > 0 && marker.every(ours)) history.go(-marker.length);
    },
  };
}

/**
 * Turns the system Back on for the stack of this host (the Lounge: a touch device, not Electron).
 * `locationKey` is the router's location key: a route change (a replace rewrites the current entry)
 * is checked against the rule too. Returns `afterEntries` (see `SystemBack`): a navigation from inside a
 * closing layer goes through it.
 */
export function useSystemBack(enabled: boolean, locationKey: string): (run: () => void) => void {
  const { overlay } = useBehaviourHost();
  const [bridge, setBridge] = useState<SystemBack | null>(null);
  const bridgeRef = useRef<SystemBack | null>(null);
  bridgeRef.current = bridge;
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
  // Stable: runs at once while the bridge is off.
  return useCallback((run: () => void) => {
    const current = bridgeRef.current;
    if (current === null) run();
    else current.afterEntries(run);
  }, []);
}
