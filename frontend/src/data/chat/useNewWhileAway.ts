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

/**
 * How many messages from others arrived while the reader was away from the bottom: the "N new" of Jump to latest.
 * Counted as the announcer counts (`hooks/useMessageListAnnouncer`), but only while the list is `live`: the first
 * live look only records where the list ends (an initial page, or a window just brought back to the present, is not
 * "new"), messages appended after it count once each, own messages and messages that
 * arrive while at the bottom do not, and a previous newest that left the loaded window counts only the new newest.
 * Back at the bottom (or on a switch) the count is 0.
 */
export function useNewWhileAway({ orderedMessages, atBottom, authorId, contextKey, live }: UseNewWhileAwayOptions): number {
  const [count, setCount] = useState(0);
  const newestRef = useRef<string | undefined>(undefined);
  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;
  // Whether the last look was already live: the first live look only records where the list ends.
  const wasLiveRef = useRef(false);

  useEffect(() => {
    newestRef.current = undefined;
    wasLiveRef.current = false;
    setCount(0);
  }, [contextKey]);

  useEffect(() => {
    if (atBottom) setCount(0);
  }, [atBottom]);

  useEffect(() => {
    const newest = orderedMessages[orderedMessages.length - 1];
    const newestKey = newest ? rowKey(newest) : undefined;
    const wasLive = wasLiveRef.current;
    wasLiveRef.current = live;
    if (!live || !wasLive) {
      newestRef.current = newestKey;
      return;
    }
    if (newestRef.current === undefined) {
      newestRef.current = newestKey;
      return;
    }
    if (newestKey === undefined || newestKey === newestRef.current) return;
    const previous = orderedMessages.findIndex((m) => rowKey(m) === newestRef.current);
    const tail = previous === -1 ? [newest!] : orderedMessages.slice(previous + 1);
    newestRef.current = newestKey;
    if (atBottomRef.current) return;
    const incoming = tail.filter((m) => m.authorId !== authorId).length;
    if (incoming > 0) setCount((c) => c + incoming);
  }, [orderedMessages, authorId, live]);

  return count;
}
