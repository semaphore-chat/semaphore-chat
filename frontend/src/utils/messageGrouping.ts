/**
 * Message grouping rules for the chat list.
 *
 * A message is "grouped" with the one above it (rendered without avatar and
 * author line) when it continues the same author's run:
 * - same author (or the same webhook), never a deleted user,
 * - sent less than {@link GROUP_WINDOW_MS} after the previous message,
 * - on the same calendar day,
 * - it isn't a quote reply (which shows its own header + quote), and
 * - the previous message doesn't carry a thread (its reply badge ends the run).
 *
 * Unread-divider breaks are decided by the list, which knows where it is.
 */
import type { Message } from '../types/message.type';
import { isSameDay } from './messageTime';

export const GROUP_WINDOW_MS = 5 * 60 * 1000;

function authorKey(message: Message): string | null {
  if (message.authorId) return `user:${message.authorId}`;
  if (message.webhook) return `webhook:${message.webhook.id}`;
  return null;
}

export function shouldGroupWithPrevious(prev: Message | undefined, curr: Message): boolean {
  if (!prev) return false;

  const key = authorKey(curr);
  if (key === null || key !== authorKey(prev)) return false;

  const gap = new Date(curr.sentAt).getTime() - new Date(prev.sentAt).getTime();
  if (!(gap >= 0 && gap < GROUP_WINDOW_MS)) return false;

  if (!isSameDay(prev.sentAt, curr.sentAt)) return false;
  if (curr.replyToId || curr.replyTo) return false;
  if ((prev.replyCount ?? 0) > 0) return false;

  return true;
}

/** True when `curr` is the first message of a calendar day in the list. */
export function startsNewDay(prev: Message | undefined, curr: Message): boolean {
  return !prev || !isSameDay(prev.sentAt, curr.sentAt);
}

export interface DayMarkers {
  /** Render a DaySeparator above this row. */
  separator: boolean;
  /** The nearest DaySeparator above this row names the row's own day, so its
   * header can drop the day and show the time only. */
  dayShownAbove: boolean;
}

/**
 * Day-separator placement for a rendered message list (oldest first).
 *
 * The first row always gets a separator (`startsNewDay(undefined, m)`), and
 * every later row either gets its own or shares the previous row's day, so
 * `dayShownAbove` is true for every row of a list rendered this way —
 * whatever window is loaded (older/newer pages, "around" loads, cap
 * eviction, optimistic rows). It is still derived from the actual separator
 * positions rather than assumed, so it stays honest if the rules change.
 */
export function dayMarkers(messages: readonly Message[]): DayMarkers[] {
  let lastSeparatorAt: string | undefined;
  return messages.map((curr, i) => {
    const separator = startsNewDay(messages[i - 1], curr);
    if (separator) lastSeparatorAt = curr.sentAt;
    return {
      separator,
      dayShownAbove: lastSeparatorAt !== undefined && isSameDay(lastSeparatorAt, curr.sentAt),
    };
  });
}
