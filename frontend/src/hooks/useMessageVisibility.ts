import { useEffect, useRef, useCallback, useContext } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SocketContext } from "../utils/SocketContext";
import { ClientEvents } from '@kraken/shared';
import { MarkAsReadPayload } from "../types/read-receipt.type";
import { readReceiptsControllerGetUnreadCountsQueryKey } from "../api-client/@tanstack/react-query.gen";
import type { UnreadCountDto } from "../api-client";

interface UseMessageVisibilityProps {
  channelId?: string;
  directMessageGroupId?: string;
  messages: Array<{ id: string }>;
  containerRef?: React.RefObject<HTMLElement>;
  enabled?: boolean;
}

/**
 * Hook to track message visibility using Intersection Observer.
 * Automatically marks messages as read when they scroll into view.
 */
export const useMessageVisibility = ({
  channelId,
  directMessageGroupId,
  messages,
  containerRef,
  enabled = true,
}: UseMessageVisibilityProps) => {
  const { socket } = useContext(SocketContext);
  const queryClient = useQueryClient();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleMessagesRef = useRef<Set<string>>(new Set());
  const lastMarkedMessageIdRef = useRef<string | null>(null);
  const pendingMessageIdRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef(messages);

  // Keep messages ref updated
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Stable callback to mark messages as read
  // Optimistic cache update runs immediately; socket emit is debounced (1s trailing)
  const markAsRead = useCallback(
    (messageId: string) => {
      if (!socket || !enabled) return;
      if (!channelId && !directMessageGroupId) return;
      if (lastMarkedMessageIdRef.current === messageId) return;

      // Optimistic cache clear — immediately remove unread/mention indicators
      const id = channelId || directMessageGroupId;
      if (id) {
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

      // Debounced socket emit — only fires after scrolling settles
      pendingMessageIdRef.current = messageId;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
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

  // Find the latest visible message using ref
  const findLatestVisibleMessage = useCallback(() => {
    if (visibleMessagesRef.current.size === 0) return null;

    let latestVisibleIndex = -1;
    let latestMessageId: string | null = null;

    messagesRef.current.forEach((message, index) => {
      if (visibleMessagesRef.current.has(message.id)) {
        if (latestVisibleIndex === -1 || index < latestVisibleIndex) {
          latestVisibleIndex = index;
          latestMessageId = message.id;
        }
      }
    });

    return latestMessageId;
  }, []); // No dependencies - uses refs

  // Set up IntersectionObserver to track which messages are visible.
  // Re-runs when messages change so newly added DOM elements get observed.
  useEffect(() => {
    if (!enabled) return;

    // Handle intersection changes
    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      let changed = false;

      entries.forEach((entry) => {
        const messageId = entry.target.getAttribute("data-message-id");
        if (!messageId) return;

        if (entry.isIntersecting) {
          if (!visibleMessagesRef.current.has(messageId)) {
            visibleMessagesRef.current.add(messageId);
            changed = true;
          }
        } else {
          if (visibleMessagesRef.current.has(messageId)) {
            visibleMessagesRef.current.delete(messageId);
            changed = true;
          }
        }
      });

      // If visibility changed, find and mark the latest visible message as read
      if (changed) {
        const latestVisible = findLatestVisibleMessage();
        if (latestVisible) {
          markAsRead(latestVisible);
        }
      }
    };

    // Use the scroll container as root for accurate visibility detection
    observerRef.current = new IntersectionObserver(handleIntersection, {
      root: containerRef?.current || null,
      rootMargin: "0px",
      threshold: 0.5, // 50% of message must be visible
    });

    // Observe all currently rendered message elements
    const root = containerRef?.current || document;
    const messageElements = root.querySelectorAll("[data-message-id]");
    messageElements.forEach((el) => {
      observerRef.current?.observe(el);
    });

    // Capture ref value for cleanup to avoid stale reference
    const visibleMessages = visibleMessagesRef.current;

    // Cleanup
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      visibleMessages.clear();
    };
  }, [enabled, containerRef, findLatestVisibleMessage, markAsRead, messages]);

  return {
    markAsRead,
  };
};
