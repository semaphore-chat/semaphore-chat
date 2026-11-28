/**
 * The row the user last activated on each Lounge route, so coming back to the route from the old shell
 * (Back from a classic chat) puts focus on that row again (design §4, M9).
 *
 * A piece calls `rememberActivatedRow(pathname, id)` when a row navigates away and marks the row's
 * focusable element with `data-lounge-row={id}`; RouteFocus looks it up on entry.
 *
 * It holds the user's community and channel ids, so it is per session: `clearShellSessionState` (the shared
 * session teardown) forgets it. Eager and dependency-free on purpose: that teardown runs in the first page
 * load, which must not reach the new shell's chunk.
 */
const rows = new Map<string, string>();
/** Stable ref callbacks that mark an element as a row (for items that take no data attributes). */
const markers = new Map<string, (element: HTMLElement | null) => void>();

/** The Lounge paths shown last, for a screen's Back (the chat's Back goes back only when it came from its home). */
let currentPathname: string | null = null;
let lastPathname: string | null = null;
let replacing: { from: string | null; before: string | null } | null = null;

export const LOUNGE_ROW_ATTRIBUTE = 'data-lounge-row';

export function rememberActivatedRow(pathname: string, rowId: string): void {
  rows.set(pathname, rowId);
}

export function rememberedRow(pathname: string): string | null {
  return rows.get(pathname) ?? null;
}

/**
 * The ref callback that marks an element with `data-lounge-row={rowId}`. One per id until the session ends, so an
 * item's ref never changes and is never detached and attached again.
 */
export function rowMarker(rowId: string): (element: HTMLElement | null) => void {
  let marker = markers.get(rowId);
  if (marker === undefined) {
    marker = (element) => element?.setAttribute(LOUNGE_ROW_ATTRIBUTE, rowId);
    markers.set(rowId, marker);
  }
  return marker;
}

/** The frame tells the memory which Lounge path shows now. */
export function notePathname(pathname: string): void {
  if (pathname === currentPathname) return;
  if (replacing !== null && replacing.from === currentPathname) {
    // A redirect replaced the current entry: the screen before it is still the one before this.
    lastPathname = replacing.before;
  } else {
    lastPathname = currentPathname;
  }
  replacing = null;
  currentPathname = pathname;
}

/**
 * The current Lounge path is about to be replaced by another (a redirect, `replace: true`): the path shown before it
 * stays the previous one, instead of the replaced path (whose entry is gone from the history).
 */
export function noteReplacing(): void {
  replacing = { from: currentPathname, before: lastPathname };
}

/** The new shell went away (the old shell shows now): what was shown before it is not a Lounge path any more. */
export function leftLounge(): void {
  currentPathname = null;
  lastPathname = null;
  replacing = null;
}

/** The Lounge path shown before the current one, or null (a cold start, or the previous screen was the old shell's). */
export function previousPathname(): string | null {
  return lastPathname;
}

/** Forgets every remembered row and row marker: the session ended (or a test starts). */
export function forgetRouteMemory(): void {
  rows.clear();
  markers.clear();
  currentPathname = null;
  lastPathname = null;
  replacing = null;
}
