import { useEffect, useRef, useCallback, useContext } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { SocketContext } from "../utils/SocketContext";
import { ClientEvents } from '@semaphore-chat/shared';
import { MarkAsReadPayload } from "../types/read-receipt.type";
import { readReceiptsControllerGetUnreadCountsQueryKey } from "../api-client/@tanstack/react-query.gen";
import type { UnreadCountDto, PaginatedMessagesResponseDto } from "../api-client";
import { channelMessagesQueryKey, dmMessagesQueryKey } from "../utils/messageQueryKeys";
import { isDetachedFromLiveEdge, isOptimisticMessageId } from "../utils/messageCacheUpdaters";
import { useWindowFocus } from "./useWindowFocus";

interface UseMessageVisibilityProps {
  channelId?: string;
  directMessageGroupId?: string;
  enabled?: boolean;
}

/**
 * Marks messages as read as they scroll into view.
 *
 * VirtualMessageList is the only renderer now — it drives visibility itself
 * (virtua's visible index range, fed to `markAsRead` via
 * `onVisibleRangeChange` in MessageContainer). This hook used to also run an
 * IntersectionObserver over the real message DOM nodes for the legacy
 * (non-virtualized) path; that branch is now dead (off-screen rows are
 * unmounted in the virtualized path and would never be observed) and has been
 * removed. What remains is purely the read-marking side effect: an optimistic
 * cache clear plus a 1s-debounced socket emit, unconditional on how the
 * caller determined visibility.
 */
export const useMessageVisibility = ({
  channelId,
  directMessageGroupId,
  enabled = true,
}: UseMessageVisibilityProps) => {
  const { socket } = useContext(SocketContext);
  const queryClient = useQueryClient();
  const isFocused = useWindowFocus();
  const lastMarkedMessageIdRef = useRef<string | null>(null);
  const pendingMessageIdRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds the latest message id seen while the tab was blurred/hidden —
  // MessageContainer keeps calling markAsRead with the newest visible id
  // even while backgrounded, so this always ends up holding the freshest one.
  const pendingWhileUnfocusedRef = useRef<string | null>(null);

  // Clean up debounce timer when deps change or on unmount,
  // preventing stale closures from emitting to the wrong channel/socket.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      pendingWhileUnfocusedRef.current = null;
    };
  }, [socket, channelId, directMessageGroupId, enabled]);

  // Stable callback to mark messages as read
  // Optimistic cache update runs immediately; socket emit is debounced (1s trailing)
  const markAsRead = useCallback(
    (messageId: string) => {
      if (!socket || !enabled) return;
      if (!channelId && !directMessageGroupId) return;
      // An optimistic message's temporary id (pending-<uuid>) doesn't exist
      // on the server, so it can't be a read mark (the server rejects it).
      // Callers pass the newest confirmed id instead (see MessageContainer).
      if (isOptimisticMessageId(messageId)) return;
      if (lastMarkedMessageIdRef.current === messageId) return;

      // Background tabs must not silently mark messages as read — stash the
      // id and replay it once focus returns (see the focus-regained effect
      // below). Checked imperatively (not via the useWindowFocus() value) so
      // this callback's identity/deps stay stable across focus changes.
      if (!(document.hasFocus() && document.visibilityState === 'visible')) {
        pendingWhileUnfocusedRef.current = messageId;
        return;
      }

      // Optimistic cache clear — immediately remove unread/mention indicators.
      // Skipped while the messages window is detached from the live edge
      // (#404 catch-up window): a mid-history message scrolling into view
      // there does not mean the user has caught up, so zeroing the badge
      // would be wrong. The server-side watermark clamp makes the emit below
      // a safe no-op for regressions, so it still fires unconditionally.
      const id = channelId || directMessageGroupId;
      if (id) {
        const messagesQueryKey = channelId
          ? channelMessagesQueryKey(channelId)
          : dmMessagesQueryKey(directMessageGroupId!);
        const messagesData = queryClient.getQueryData<
          InfiniteData<PaginatedMessagesResponseDto>
        >(messagesQueryKey);
        const detached = isDetachedFromLiveEdge(messagesData);

        if (!detached) {
          const queryKey = readReceiptsControllerGetUnreadCountsQueryKey();
          queryClient.setQueryData(queryKey, (old: UnreadCountDto[] | undefined) => {
            if (!old) return old;
            const index = old.findIndex(
              (c) => (c.channelId || c.directMessageGroupId) === id
            );
            if (index < 0) return old;
            const next = [...old];
            next[index] = {
              ...next[index],
              unreadCount: 0,
              mentionCount: 0,
              lastReadMessageId: messageId,
              lastReadAt: new Date().toISOString(),
            };
            return next;
          });
        }
      }

      // Debounced socket emit — only fires after scrolling settles
      pendingMessageIdRef.current = messageId;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        const pendingId = pendingMessageIdRef.current;
        if (!pendingId || lastMarkedMessageIdRef.current === pendingId) return;

        const payload: MarkAsReadPayload = {
          lastReadMessageId: pendingId,
          ...(channelId ? { channelId } : { directMessageGroupId }),
        };

        socket.emit(ClientEvents.MARK_AS_READ, payload);
        lastMarkedMessageIdRef.current = pendingId;
        debounceTimerRef.current = null;
      }, 1000);
    },
    [socket, channelId, directMessageGroupId, enabled, queryClient]
  );

  // Replay the most recent visible message once the tab regains focus.
  useEffect(() => {
    if (!isFocused) return;
    if (!socket || !enabled) return;
    const pendingId = pendingWhileUnfocusedRef.current;
    if (!pendingId) return;
    pendingWhileUnfocusedRef.current = null;
    markAsRead(pendingId);
  }, [isFocused, socket, enabled, markAsRead]);

  return {
    markAsRead,
  };
};
