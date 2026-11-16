import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { Message } from "../../types/message.type";
import { useMessageVisibility } from "../../hooks/useMessageVisibility";
import { isOptimisticMessageId } from "../../utils/messageCacheUpdaters";
import { useReadReceipts } from "../../hooks/useReadReceipts";

export interface UseReadMarksOptions {
  /** The loaded messages in chronological (oldest-first) render order. */
  orderedMessages: Message[];
  isLoading: boolean;
  channelId?: string;
  directMessageGroupId?: string;
  /** Context identity (channel or DM group id): resets the detachment tracking on a switch. */
  contextKey?: string;

  // Live-edge detachment (normal mode): deep scrollback evicted the newest
  // page, so the loaded bottom is not the present (#404).
  isDetachedFromPresent?: boolean;
  resetToPresent?: () => Promise<void>;

  /** The list's scroll-to-bottom and pinned state, read at scroll time (latest values). */
  scrollToBottomRef: RefObject<() => void>;
  atBottomRef: RefObject<boolean>;
}

export interface UseReadMarksResult {
  /** The detached window's "Jump to present": reset the window to the live edge. */
  handleDetachedJumpToPresent: () => void;
  /** Feed the list's visible index range ([start, end], render order) here. */
  handleVisibleRangeChange: (startIndex: number, endIndex: number) => void;
  /** Unread messages in this conversation (from the read receipts cache). */
  unreadCount: number;
  /** Render-order index of the last read message (the unread divider goes after it), or -1. */
  lastReadIndex: number;
}

/** An optimistic row the server hasn't confirmed yet (its id is temporary). */
function isUnconfirmed(message: Message): boolean {
  return message.sendStatus !== undefined || isOptimisticMessageId(message.id);
}

/**
 * The read-marking glue of a message list, shared by both shells: the visible
 * range → newest confirmed id → markAsRead (useMessageVisibility), optimistic
 * rows confirmed while in view, the unread divider's index, and the detached
 * window's follow-through back to the live edge (#404).
 */
export function useReadMarks({
  orderedMessages,
  isLoading,
  channelId,
  directMessageGroupId,
  contextKey,
  isDetachedFromPresent,
  resetToPresent,
  scrollToBottomRef,
  atBottomRef,
}: UseReadMarksOptions): UseReadMarksResult {
  const handleDetachedJumpToPresent = useCallback(() => {
    void resetToPresent?.();
  }, [resetToPresent]);

  // Reset detachment tracking when switching contexts (channel/DM change) so
  // a stale wasDetachedRef from the previous context can't trigger a scroll
  // in the new one. Declared before the scroll-follow-through effect below so
  // it runs first within the same commit when both contextKey and
  // isDetachedFromPresent change together (i.e. switching away from a
  // detached channel).
  const wasDetachedRef = useRef(false);
  useEffect(() => {
    wasDetachedRef.current = false;
  }, [contextKey]);

  // Scroll to the bottom once a detached window returns to the live edge —
  // covers the FAB, own-send reset, and reconnect reset uniformly. The reset
  // clears data first (isDetachedFromPresent flips false while empty), so
  // wait for the refetched page to render before scrolling. Retry across a
  // few frames until the scroll actually lands (atBottom) — VirtualMessageList
  // itself may not have finished measuring/mounting the refetched page on the
  // very first attempt.
  useEffect(() => {
    if (isDetachedFromPresent) {
      wasDetachedRef.current = true;
      return;
    }
    if (!wasDetachedRef.current) return;
    if (orderedMessages.length === 0) return;
    wasDetachedRef.current = false;
    let attempts = 0;
    const tryScroll = () => {
      scrollToBottomRef.current();
      attempts += 1;
      if (attempts < 10 && !atBottomRef.current) {
        requestAnimationFrame(tryScroll);
      }
    };
    requestAnimationFrame(tryScroll);
  }, [isDetachedFromPresent, orderedMessages, scrollToBottomRef, atBottomRef]);

  // Auto-mark messages as read when they scroll into view. VirtualMessageList
  // is the only renderer, so visibility is always fed from its visible index
  // range below — there is no DOM IntersectionObserver path anymore.
  // markAsRead keeps the same optimistic-update + 1s-debounced-emit path.
  const { markAsRead } = useMessageVisibility({
    channelId,
    directMessageGroupId,
    enabled: !isLoading && orderedMessages.length > 0,
  });

  // The latest (newest) visible message is the end of virtua's visible index
  // range in the chronological render order. Each range change updates the
  // pending mark; the debounce inside markAsRead means the range at debounce
  // time wins, so fast scroll-throughs don't emit per-message. This fires in
  // anchored mode too — the legacy IntersectionObserver it replaces had no
  // mode gating either, so messages scrolling into view while reading
  // history via a jump are marked read exactly as before. Out-of-range
  // indices (estimate overshoot at the list edge) are clamped; empty/invalid
  // ranges are ignored.
  //
  // Own sends: an optimistic row (sendStatus 'pending'/'failed') has a
  // temporary pending-<uuid> id the server has never seen, so the mark goes
  // to the newest *confirmed* message in the range instead. The clientIds of
  // the optimistic rows skipped that way are kept, because the ack swaps a
  // row's id in place (same clientId key, same height): no new range is
  // reported, so the effect below marks the real id when one is confirmed
  // while still in view. markAsRead applies the usual debounce and
  // background-tab rules to that mark too.
  const orderedMessagesRef = useRef(orderedMessages);
  orderedMessagesRef.current = orderedMessages;
  const unconfirmedInViewRef = useRef<Set<string>>(new Set());
  const handleVisibleRangeChange = useCallback(
    (startIndex: number, endIndex: number) => {
      const ordered = orderedMessagesRef.current;
      if (ordered.length === 0 || endIndex < 0 || endIndex < startIndex) return;
      const last = Math.min(endIndex, ordered.length - 1);
      const first = Math.min(Math.max(startIndex, 0), last);
      const unconfirmed = new Set<string>();
      let newestConfirmed: Message | undefined;
      for (let i = last; i >= first; i--) {
        const message = ordered[i];
        if (!isUnconfirmed(message)) {
          newestConfirmed = message;
          break;
        }
        if (message.clientId) unconfirmed.add(message.clientId);
      }
      unconfirmedInViewRef.current = unconfirmed;
      if (newestConfirmed) markAsRead(newestConfirmed.id);
    },
    [markAsRead],
  );

  useEffect(() => {
    const unconfirmed = unconfirmedInViewRef.current;
    if (unconfirmed.size === 0) return;
    // Newest first: optimistic rows sit at the live edge, so the scan stops
    // at the tail once every tracked row is found. Every confirmed one leaves
    // the set (so an older one can't be marked on a later update), and the
    // first confirmed is the newest, the one to mark.
    let newlyConfirmed: Message | undefined;
    const stillPending = new Set<string>();
    let seen = 0;
    for (let i = orderedMessages.length - 1; i >= 0 && seen < unconfirmed.size; i--) {
      const message = orderedMessages[i];
      if (!message.clientId || !unconfirmed.has(message.clientId)) continue;
      seen += 1;
      if (isUnconfirmed(message)) stillPending.add(message.clientId);
      else newlyConfirmed ??= message;
    }
    // Keep only the rows still waiting for their ack: confirmed ones are
    // done, and ones no longer in the list (deleted, or replaced by a
    // separately inserted echo) would otherwise force a full scan each time.
    unconfirmedInViewRef.current = stillPending;
    if (newlyConfirmed) markAsRead(newlyConfirmed.id);
  }, [orderedMessages, markAsRead]);

  // Read receipts - determine where to show unread divider
  const { lastReadMessageId: getLastReadMessageId, unreadCount: getUnreadCount } = useReadReceipts();
  const lastReadMessageId = getLastReadMessageId(contextKey);
  const unreadCount = getUnreadCount(contextKey);

  // Find the index of the last read message in the chronological (oldest-first)
  // render order; the divider goes right after it, before the first unread.
  const lastReadIndex = useMemo(() => {
    if (!lastReadMessageId) return -1;
    return orderedMessages.findIndex((msg) => msg.id === lastReadMessageId);
  }, [orderedMessages, lastReadMessageId]);

  return { handleDetachedJumpToPresent, handleVisibleRangeChange, unreadCount, lastReadIndex };
}
