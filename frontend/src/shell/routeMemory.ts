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

/** Forgets every remembered row and row marker: the session ended (or a test starts). */
export function forgetRouteMemory(): void {
  rows.clear();
  markers.clear();
}
