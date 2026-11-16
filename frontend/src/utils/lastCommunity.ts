/**
 * The community the user last opened, for the classic phone and tablet Home tab
 * (`MobileNavigationContext`). Both shells write it: the classic layouts when they show a community route, and
 * the new shell's community home (`CommunityLeft`), so Home returns to the community last opened in either.
 *
 * Headless: storage only, no UI. A storage failure (private mode, blocked site data) reads as "none" and a write
 * that fails is ignored.
 */
export const LAST_COMMUNITY_KEY = 'semaphore:lastCommunityId';

export function readLastCommunity(): string | null {
  try {
    return localStorage.getItem(LAST_COMMUNITY_KEY);
  } catch {
    return null;
  }
}

export function rememberLastCommunity(id: string): void {
  try {
    localStorage.setItem(LAST_COMMUNITY_KEY, id);
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}
