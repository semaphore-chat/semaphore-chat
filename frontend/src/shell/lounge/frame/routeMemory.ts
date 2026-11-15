/**
 * The row the user last activated on each Lounge route, so coming back to the route from the old shell
 * (Back from a classic chat) puts focus on that row again (design §4, M9).
 *
 * A piece calls `rememberActivatedRow(pathname, id)` when a row navigates away and marks the row's
 * focusable element with `data-lounge-row={id}`; RouteFocus looks it up on entry.
 */
const rows = new Map<string, string>();

export const LOUNGE_ROW_ATTRIBUTE = 'data-lounge-row';

export function rememberActivatedRow(pathname: string, rowId: string): void {
  rows.set(pathname, rowId);
}

export function rememberedRow(pathname: string): string | null {
  return rows.get(pathname) ?? null;
}

/** For tests. */
export function forgetActivatedRows(): void {
  rows.clear();
}
