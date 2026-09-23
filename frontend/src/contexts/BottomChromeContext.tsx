/* eslint-disable react-refresh/only-export-components */
/**
 * BottomChromeContext — one layout manager for everything that is pinned to
 * the top or bottom edge of the screen.
 *
 * Before this, every piece of edge chrome (bottom nav, voice bar, composer,
 * "Update available" / install snackbars, the "Reconnecting…" chip, the new-DM
 * FAB, the offline banner, the incoming-call banner) hard-coded its own
 * `bottom:` / `top:` from constants and guessed what else might be on screen.
 * They overlapped whenever more than one was showing.
 *
 * Now each piece registers `{ id, height, order }` with a shared store, and
 * anything that floats above the stack asks for its offset:
 *
 *   bottom (order, bottom-up): nav 0 → voice bar 10 → composer 20 → toast 30
 *                              → FAB 35 → "Reconnecting…" chip 40
 *   top    (order, top-down):  offline strip 0 → incoming call 10
 *
 * An item's offset is the sum of everything registered on the same edge with
 * a LOWER order. Items that share an order are alternatives at the same level
 * (e.g. two composers, only one of which is visible), so a level contributes
 * the height of its tallest item, not the sum.
 *
 * The nav and voice bar are in normal flow in the mobile/tablet layouts (so
 * they can never cover content); they still register their heights so the
 * `position: fixed` pieces above them know where to sit.
 *
 * Safe area: floating items get `env(safe-area-inset-bottom)` added through a
 * CSS var (`--sc-safe-area-bottom`, overridable in stories/tests). While the
 * on-screen keyboard is open (see `useKeyboardInset`) the keyboard height is
 * used instead — the keyboard already covers the home-indicator area.
 *
 * The provider is optional: without one, every hook uses a single app-wide
 * store. That's deliberate — the chrome lives at very different levels of the
 * tree (`AppChrome` in App.tsx, `ConnectionStatusBanner` in AuthGate, the call
 * banner in LayoutProviders, the nav in the layouts). Tests wrap in
 * `<BottomChromeProvider>` to get an isolated store.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';

// ── Types & constants ────────────────────────────────────────────────────

export type ChromeEdge = 'top' | 'bottom';

export interface ChromeItem {
  id: string;
  height: number;
  order: number;
  edge: ChromeEdge;
}

/** Bottom stack, bottom-up. */
export const BOTTOM_CHROME_ORDER = {
  NAV: 0,
  VOICE_BAR: 10,
  COMPOSER: 20,
  TOAST: 30,
  /** Screen FABs (new DM) — above a toast, so a toast never hides them. */
  FAB: 35,
  CHIP: 40,
} as const;

/** Top stack, top-down (below the status bar / safe area). */
export const TOP_CHROME_ORDER = {
  OFFLINE: 0,
  INCOMING_CALL: 10,
} as const;

/** Only one snackbar shows at a time; lower number wins. */
export const TOAST_PRIORITY = {
  UPDATE: 0,
  INSTALL: 10,
} as const;

/** Bottom safe-area inset, overridable via `--sc-safe-area-bottom`. */
export const SAFE_AREA_BOTTOM = 'var(--sc-safe-area-bottom, env(safe-area-inset-bottom, 0px))';
/** Top safe-area inset, overridable via `--sc-safe-area-top`. */
export const SAFE_AREA_TOP = 'var(--sc-safe-area-top, env(safe-area-inset-top, 0px))';

/**
 * Keyboard insets smaller than this are browser toolbars collapsing/expanding,
 * not an on-screen keyboard.
 */
export const KEYBOARD_MIN_INSET = 120;

// ── Pure layout maths (unit-tested directly) ─────────────────────────────

/**
 * Sum of the heights registered on `edge` below `order` (for the bottom edge)
 * or above it (for the top edge). Items sharing an order count once, at the
 * tallest height.
 */
export function computeChromeOffset(items: readonly ChromeItem[], order: number, edge: ChromeEdge = 'bottom'): number {
  const tallestPerLevel = new Map<number, number>();
  for (const item of items) {
    if (item.edge !== edge || item.order >= order || item.height <= 0) continue;
    tallestPerLevel.set(item.order, Math.max(tallestPerLevel.get(item.order) ?? 0, item.height));
  }
  let total = 0;
  for (const h of tallestPerLevel.values()) total += h;
  return Math.round(total);
}

export interface BottomOffset {
  /** Pixels of registered chrome below this item (keyboard included, safe area not). */
  px: number;
  /** Ready-to-use CSS length: `px` plus the safe area (or the keyboard height). */
  css: string;
}

/**
 * Offset from the bottom of the viewport for something at `order`. With the
 * keyboard open, its height replaces the safe area (the keyboard covers it).
 */
export function computeBottomOffset(
  items: readonly ChromeItem[],
  order: number,
  keyboardInset: number,
  skipOrders: readonly number[] = [],
): BottomOffset {
  const counted = skipOrders.length ? items.filter((i) => !skipOrders.includes(i.order)) : items;
  const chrome = computeChromeOffset(counted, order, 'bottom');
  if (keyboardInset > 0) {
    const px = chrome + keyboardInset;
    return { px, css: `${px}px` };
  }
  return { px: chrome, css: `calc(${chrome}px + ${SAFE_AREA_BOTTOM})` };
}

/** Offset from the top of the viewport (below the safe area) for something at `order`. */
export function computeTopOffset(items: readonly ChromeItem[], order: number): BottomOffset {
  const px = computeChromeOffset(items, order, 'top');
  return { px, css: `calc(${px}px + ${SAFE_AREA_TOP})` };
}

/** Total height of everything registered on the top edge. */
export function computeTopChromeHeight(items: readonly ChromeItem[]): number {
  return computeChromeOffset(items, Number.POSITIVE_INFINITY, 'top');
}

/**
 * Which queued toast may show: lowest priority number, ties broken by who
 * asked first.
 */
export function pickActiveToast(requests: ReadonlyArray<{ id: string; priority: number; seq: number }>): string | null {
  let best: { id: string; priority: number; seq: number } | null = null;
  for (const r of requests) {
    if (!best || r.priority < best.priority || (r.priority === best.priority && r.seq < best.seq)) best = r;
  }
  return best?.id ?? null;
}

/** Keyboard height from the visual viewport (0 when closed or unsupported). */
export function readKeyboardInset(win: Window | undefined = typeof window === 'undefined' ? undefined : window): number {
  const vv = win?.visualViewport;
  if (!win || !vv) return 0;
  // Pinch-zoom also shrinks the visual viewport; that isn't a keyboard.
  if ((vv.scale ?? 1) > 1.01) return 0;
  const inset = Math.round(win.innerHeight - vv.height - vv.offsetTop);
  return inset >= KEYBOARD_MIN_INSET ? inset : 0;
}

// ── Store ────────────────────────────────────────────────────────────────

interface ChromeSnapshot {
  items: ChromeItem[];
  toasts: Array<{ id: string; priority: number; seq: number }>;
  topHosts: number;
}

export interface BottomChromeStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ChromeSnapshot;
  setItem(item: ChromeItem): void;
  removeItem(id: string): void;
  requestToast(id: string, priority: number): void;
  releaseToast(id: string): void;
  addTopHost(): () => void;
}

export function createBottomChromeStore(): BottomChromeStore {
  let snapshot: ChromeSnapshot = { items: [], toasts: [], topHosts: 0 };
  let seq = 0;
  const listeners = new Set<() => void>();
  const emit = (next: ChromeSnapshot) => {
    snapshot = next;
    listeners.forEach((l) => l());
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    setItem(item) {
      const existing = snapshot.items.find((i) => i.id === item.id);
      if (
        existing &&
        existing.height === item.height &&
        existing.order === item.order &&
        existing.edge === item.edge
      ) {
        return;
      }
      emit({ ...snapshot, items: [...snapshot.items.filter((i) => i.id !== item.id), item] });
    },
    removeItem(id) {
      if (!snapshot.items.some((i) => i.id === id)) return;
      emit({ ...snapshot, items: snapshot.items.filter((i) => i.id !== id) });
    },
    requestToast(id, priority) {
      const existing = snapshot.toasts.find((t) => t.id === id);
      if (existing && existing.priority === priority) return;
      const entry = { id, priority, seq: existing?.seq ?? seq++ };
      emit({ ...snapshot, toasts: [...snapshot.toasts.filter((t) => t.id !== id), entry] });
    },
    releaseToast(id) {
      if (!snapshot.toasts.some((t) => t.id === id)) return;
      emit({ ...snapshot, toasts: snapshot.toasts.filter((t) => t.id !== id) });
    },
    addTopHost() {
      emit({ ...snapshot, topHosts: snapshot.topHosts + 1 });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        emit({ ...snapshot, topHosts: Math.max(0, snapshot.topHosts - 1) });
      };
    },
  };
}

/** App-wide store used when no provider is mounted (the real app). */
const defaultStore = createBottomChromeStore();

const BottomChromeContext = createContext<BottomChromeStore | null>(null);

/** Isolated store for a subtree (tests, stories that need their own stack). */
export const BottomChromeProvider: React.FC<{ children: React.ReactNode; store?: BottomChromeStore }> = ({
  children,
  store,
}) => {
  const [ownStore] = useState(() => store ?? createBottomChromeStore());
  return <BottomChromeContext.Provider value={store ?? ownStore}>{children}</BottomChromeContext.Provider>;
};

function useChromeStore(): BottomChromeStore {
  return useContext(BottomChromeContext) ?? defaultStore;
}

function useChromeSnapshot(): ChromeSnapshot {
  const store = useChromeStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// ── Keyboard ─────────────────────────────────────────────────────────────

function subscribeKeyboard(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const vv = window.visualViewport;
  vv?.addEventListener('resize', callback);
  vv?.addEventListener('scroll', callback);
  window.addEventListener('resize', callback);
  return () => {
    vv?.removeEventListener('resize', callback);
    vv?.removeEventListener('scroll', callback);
    window.removeEventListener('resize', callback);
  };
}

const getKeyboardInset = () => readKeyboardInset();
const getServerKeyboardInset = () => 0;

/**
 * Height of the on-screen keyboard in px (0 when closed), from
 * `window.visualViewport`. On browsers that resize the layout viewport for
 * the keyboard this stays 0 — nothing is covered, so there's nothing to add.
 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribeKeyboard, getKeyboardInset, getServerKeyboardInset);
}

// ── Registration ─────────────────────────────────────────────────────────

export interface ChromeItemOptions {
  /** Stable id; defaults to a per-instance `useId()`. */
  id?: string;
  order: number;
  edge?: ChromeEdge;
  /** Height in px. Ignored (measured instead) by `useMeasuredChromeItem`. */
  height?: number;
  /** Register only while true (e.g. while the toast is open). */
  enabled?: boolean;
}

/** Register a fixed-height item while mounted and enabled. */
export function useChromeItem({ id, order, edge = 'bottom', height = 0, enabled = true }: ChromeItemOptions): void {
  const store = useChromeStore();
  const autoId = useId();
  const key = id ?? autoId;
  useEffect(() => {
    if (!enabled) return undefined;
    store.setItem({ id: key, order, edge, height });
    return undefined;
  }, [store, key, order, edge, height, enabled]);
  useEffect(() => {
    if (!enabled) return undefined;
    return () => store.removeItem(key);
  }, [store, key, enabled]);
}

/**
 * Register an item whose height is measured from the DOM (ResizeObserver).
 * Returns a callback ref for the element to measure. A hidden element
 * (`display: none`) measures 0 and so drops out of the stack by itself.
 * Where ResizeObserver doesn't exist (jsdom), `fallbackHeight` is used.
 */
export function useMeasuredChromeItem(
  options: Omit<ChromeItemOptions, 'height'> & {
    fallbackHeight?: number;
    /**
     * Added to a non-zero measured height — e.g. a snackbar's gap below it,
     * so whatever stacks above the toast clears the gap too.
     */
    extraHeight?: number;
  },
): (el: HTMLElement | null) => void {
  const { fallbackHeight = 0, extraHeight = 0, ...rest } = options;
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!el) {
      setHeight(0);
      return undefined;
    }
    if (typeof ResizeObserver === 'undefined') {
      setHeight(fallbackHeight);
      return undefined;
    }
    const measure = () => setHeight(Math.round(el.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, fallbackHeight]);

  useChromeItem({
    ...rest,
    height: height > 0 ? height + extraHeight : 0,
    enabled: (rest.enabled ?? true) && !!el,
  });
  return useCallback((node: HTMLElement | null) => setEl(node), []);
}

// ── Consumers ────────────────────────────────────────────────────────────

/**
 * Offset from the bottom of the viewport for something that floats at
 * `order` (see `BOTTOM_CHROME_ORDER`): the heights of everything registered
 * below it, plus the safe area — or the keyboard, while it's open.
 * `skipOrders` leaves out levels that aren't horizontally under the caller
 * (e.g. the composer, for the chip over the tablet/desktop sidebar).
 */
export function useBottomChromeOffset(order: number, options?: { skipOrders?: readonly number[] }): BottomOffset {
  const { items } = useChromeSnapshot();
  const keyboardInset = useKeyboardInset();
  // Joined to a string so an inline array literal doesn't defeat the memo.
  const skipKey = options?.skipOrders?.join(',') ?? '';
  return useMemo(
    () => computeBottomOffset(items, order, keyboardInset, skipKey ? skipKey.split(',').map(Number) : []),
    [items, order, keyboardInset, skipKey],
  );
}

/** Offset from the top of the viewport for a top-edge item at `order`. */
export function useTopChromeOffset(order: number): BottomOffset {
  const { items } = useChromeSnapshot();
  return useMemo(() => computeTopOffset(items, order), [items, order]);
}

/**
 * Called by a layout that reserves room for top chrome (pads its content
 * down by the returned height). While at least one such layout is mounted,
 * top-edge items render as push-down strips instead of overlays.
 */
export function useTopChromeHost(): number {
  const store = useChromeStore();
  const { items } = useChromeSnapshot();
  useEffect(() => store.addTopHost(), [store]);
  return useMemo(() => computeTopChromeHeight(items), [items]);
}

/** Whether a layout that pushes content down for top chrome is mounted. */
export function useHasTopChromeHost(): boolean {
  return useChromeSnapshot().topHosts > 0;
}

/**
 * Toast queue: call with `wantsToShow` true while this toast has something to
 * say; returns whether it's this toast's turn. Only one queued toast shows at
 * a time — the lowest `priority` (see `TOAST_PRIORITY`).
 */
export function useToastQueue(id: string, priority: number, wantsToShow: boolean): boolean {
  const store = useChromeStore();
  const { toasts } = useChromeSnapshot();
  useEffect(() => {
    if (!wantsToShow) return undefined;
    store.requestToast(id, priority);
    return () => store.releaseToast(id);
  }, [store, id, priority, wantsToShow]);
  return wantsToShow && pickActiveToast(toasts) === id;
}

/** MUI's own gap below a bottom-anchored snackbar: 8px on xs, 24px from sm. */
export const SNACKBAR_GAP = { xs: 8, sm: 24 } as const;

/** The snackbar gap at the current width (see `SNACKBAR_GAP`). */
export function useSnackbarGap(): number {
  const theme = useTheme();
  const isSmUp = useMediaQuery(theme.breakpoints.up('sm'));
  return isSmUp ? SNACKBAR_GAP.sm : SNACKBAR_GAP.xs;
}

/**
 * `sx` for an MUI `<Snackbar anchorOrigin={{ vertical: 'bottom' }}>` so it
 * clears the chrome below it, keeping `gap` (from `useSnackbarGap`) on top.
 * Register the toast with the same gap as `extraHeight` so chrome above it
 * (the chip, FABs) clears the gap as well as the toast.
 */
export function snackbarBottomSx(offset: BottomOffset, gap: number) {
  const bottom = `calc(${offset.css} + ${gap}px)`;
  // Both keys on purpose: MUI's Snackbar sets its own `bottom` inside an
  // `sm` media query, which would beat a plain (non-media) value.
  return { bottom: { xs: bottom, sm: bottom } } as const;
}
