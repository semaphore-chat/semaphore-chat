/**
 * Shallow equality for the list host's opaque `RowFocus` (a tab index and two callbacks the host keeps per row), so a
 * memoised row re-renders only when its own Tab stop changes, not on every render of the list.
 */
export function sameRowFocus(a: object, b: object): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((key) => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]);
}
