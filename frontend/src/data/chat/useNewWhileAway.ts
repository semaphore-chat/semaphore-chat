import { useEffect, useRef, useState } from 'react';
import type { Message } from '../../types/message.type';

export interface UseNewWhileAwayOptions {
  /** Chronological (oldest-first) render order, the array the list core gets. */
  orderedMessages: readonly Message[];
  /** Whether the list is pinned to the live edge (the list core's `onAtBottomChange`). */
  atBottom: boolean;
  /** The reader: their own messages never count. */
  authorId: string;
  /** Channel or DM identity: a switch starts again from nothing. */
  contextKey?: string;
  /**
   * The list follows the live edge of the conversation: the normal window, not detached from the present (#404),
   * not an anchored window after a jump. Only then is an appended message a live arrival; a page loaded toward the
   * present (after a `?highlight=` jump) or a window brought back to the live edge is history, never "new".
   */
  live: boolean;
}

const rowKey = (message: Message) => message.clientId ?? message.id;

/** A message's time in milliseconds (0 when unreadable). */
const timeOf = (message: Message) => {
  const ms = Date.parse(message.sentAt);
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * How many messages from others arrived while the reader was away from the bottom: the "N new" of Jump to latest.
 * Only arrivals count: a message whose id was never in the window before and that is at least as new as the newest
 * one already seen, while the list is `live` and the reader is away from the bottom. Everything else only widens what
 * is known: the first live look (an initial page, or a window just brought back to the present), pages of history,
 * and whatever is there while at the bottom. So a deleted newest message, an older page, or a refetched window never
 * counts, and the reader's own messages never do. Back at the bottom (or on a switch) the count is 0.
 */
export function useNewWhileAway({ orderedMessages, atBottom, authorId, contextKey, live }: UseNewWhileAwayOptions): number {
  const [count, setCount] = useState(0);
  // Every row key and id seen in this conversation, and the newest time among them.
  const knownRef = useRef<Set<string>>(new Set());
  const latestRef = useRef(0);
  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;
  // Whether the last look was already live: the first live look only records what is there.
  const wasLiveRef = useRef(false);

  useEffect(() => {
    knownRef.current = new Set();
    latestRef.current = 0;
    wasLiveRef.current = false;
    setCount(0);
  }, [contextKey]);

  useEffect(() => {
    if (atBottom) setCount(0);
  }, [atBottom]);

  useEffect(() => {
    const known = knownRef.current;
    const wasLive = wasLiveRef.current;
    wasLiveRef.current = live;
    const countNow = live && wasLive && !atBottomRef.current;
    let incoming = 0;
    for (const message of orderedMessages) {
      const key = rowKey(message);
      const isNew = !known.has(key) && !known.has(message.id);
      if (isNew && countNow && timeOf(message) >= latestRef.current && message.authorId !== authorId) incoming += 1;
      known.add(key);
      known.add(message.id);
    }
    for (const message of orderedMessages) latestRef.current = Math.max(latestRef.current, timeOf(message));
    if (incoming > 0) setCount((c) => c + incoming);
  }, [orderedMessages, authorId, live]);

  return count;
}
