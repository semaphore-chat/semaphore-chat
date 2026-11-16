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
}

const rowKey = (message: Message) => message.clientId ?? message.id;

/**
 * How many messages from others arrived while the reader was away from the bottom: the "N new" of Jump to latest.
 * Counted as the announcer counts (`hooks/useMessageListAnnouncer`): the first look only records where the list
 * ends (an initial page is not "new"), messages appended after it count once each, own messages and messages that
 * arrive while at the bottom do not, and a previous newest that left the loaded window counts only the new newest.
 * Back at the bottom (or on a switch) the count is 0.
 */
export function useNewWhileAway({ orderedMessages, atBottom, authorId, contextKey }: UseNewWhileAwayOptions): number {
  const [count, setCount] = useState(0);
  const newestRef = useRef<string | undefined>(undefined);
  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;

  useEffect(() => {
    newestRef.current = undefined;
    setCount(0);
  }, [contextKey]);

  useEffect(() => {
    if (atBottom) setCount(0);
  }, [atBottom]);

  useEffect(() => {
    const newest = orderedMessages[orderedMessages.length - 1];
    const newestKey = newest ? rowKey(newest) : undefined;
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
  }, [orderedMessages, authorId]);

  return count;
}
