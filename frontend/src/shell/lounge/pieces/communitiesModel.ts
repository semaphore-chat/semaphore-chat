/**
 * The words and ids the dock and the "All communities" sheet share (pure; the components import them).
 */

export const INBOX_ROW = 'inbox';
export const ALL_ROW = 'all';
export const DOCK_LABEL = 'Communities';
export const ALL_LABEL = 'All communities';
export const SHEET_TITLE = 'All communities';
/** More communities than this and the sheet shows its filter field. */
export const FILTER_THRESHOLD = 8;
/** The sheet's foot rows (list focus ids). */
export const FOOT_ROWS = {
  create: 'create-community',
  notifications: 'notifications',
  settings: 'settings',
  profile: 'profile',
  signOut: 'sign-out',
} as const;
const FOOT_IDS: ReadonlySet<string> = new Set(Object.values(FOOT_ROWS));

export function isFootRow(id: string): boolean {
  return FOOT_IDS.has(id);
}

/** The foot's Notifications row's count, as words for its name: "3 unread"; none at 0. */
export function notificationCountText(count: number): string | undefined {
  return count > 0 ? `${count.toLocaleString()} unread` : undefined;
}

/** The `data-lounge-row` id of a community's dock item (RouteFocus lands on it after Back from the old shell). */
export function dockRowId(communityId: string): string {
  return `dock:${communityId}`;
}

export function mentionText(count: number): string {
  return count === 1 ? '1 mention' : `${count} mentions`;
}

export interface CommunityState {
  mentions: number;
  newMessages: boolean;
  inYourCall: boolean;
}

/** A sheet row's second line: the call first, then mentions, new messages, or quiet. */
export function stateLine(community: CommunityState): string {
  if (community.inYourCall) return "You're in a call here";
  if (community.mentions > 0) return mentionText(community.mentions);
  if (community.newMessages) return 'New messages';
  return 'Quiet';
}

/** The filter: a case-insensitive part of the name; blank matches everything. */
export function matchesFilter(name: string, filter: string): boolean {
  const query = filter.trim().toLocaleLowerCase();
  return query === '' || name.toLocaleLowerCase().includes(query);
}

/** How long typing must pause before the filter's result is announced. */
export const FILTER_ANNOUNCE_DELAY_MS = 600;

/** What the filter's result says to a screen reader: the count, or that nothing matches. */
export function filterAnnouncement(query: string, count: number): string {
  if (count === 0) return `No community called “${query}”`;
  return count === 1 ? '1 community' : `${count} communities`;
}
