import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import MessageComponent from "./MessageComponent";
import { Box, Typography, Fab } from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import MessageSkeleton from "./MessageSkeleton";
import { UnreadMessageDivider } from "./UnreadMessageDivider";
import type { Message } from "../../types/message.type";
import { useMessageVisibility } from "../../hooks/useMessageVisibility";
import { useReadReceipts } from "../../hooks/useReadReceipts";
import { useResponsive } from "../../hooks/useResponsive";
import { VoiceSessionType } from "../../contexts/VoiceContext";
import TypingIndicator from "./TypingIndicator";

interface MessageContainerProps {
  // Data
  messages: Message[];
  isLoading: boolean;
  error: unknown;
  authorId: string;

  // Pagination
  continuationToken?: string;
  isLoadingMore: boolean;
  onLoadMore?: () => Promise<void>;

  // Message Input
  messageInput: React.ReactNode;

  // Member List
  memberListComponent?: React.ReactNode;
  showMemberList?: boolean;

  // Optional customization
  emptyStateMessage?: string;

  // Search highlight
  highlightMessageId?: string;

  // Thread handling
  contextId?: string;
  communityId?: string;
  onOpenThread?: (message: Message) => void;

  // Read receipts
  channelId?: string;
  directMessageGroupId?: string;
}

const MessageContainer: React.FC<MessageContainerProps> = ({
  messages,
  isLoading,
  error,
  authorId,
  continuationToken,
  isLoadingMore,
  onLoadMore,
  messageInput,
  memberListComponent,
  showMemberList = true,
  emptyStateMessage = "No messages yet. Start the conversation!",
  highlightMessageId,
  contextId,
  communityId,
  onOpenThread,
  channelId,
  directMessageGroupId,
}) => {
  const { isMobile } = useResponsive();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [atBottom, setAtBottom] = useState(true);

  // Auto-mark messages as read when they scroll into view
  useMessageVisibility({
    channelId,
    directMessageGroupId,
    messages,
    containerRef: scrollContainerRef,
    enabled: !isLoading && messages.length > 0,
  });

  // Read receipts - determine where to show unread divider
  const contextKey = channelId || directMessageGroupId;
  const { lastReadMessageId: getLastReadMessageId, unreadCount: getUnreadCount } = useReadReceipts();
  const lastReadMessageId = getLastReadMessageId(contextKey);
  const unreadCount = getUnreadCount(contextKey);

  // Find the index of the last read message in the newest-first array
  const lastReadIndex = useMemo(() => {
    if (!lastReadMessageId) return -1;
    return messages.findIndex((msg) => msg.id === lastReadMessageId);
  }, [messages, lastReadMessageId]);

  // "At bottom" detection via IntersectionObserver on bottom sentinel
  // Bottom sentinel is first in DOM = visual bottom in column-reverse
  const hasMessages = messages.length > 0;
  useEffect(() => {
    const sentinel = bottomSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      ([entry]) => setAtBottom(entry.isIntersecting),
      { root: container, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMessages]);

  // "Load more" pagination via IntersectionObserver on top sentinel
  // Top sentinel is last in DOM = visual top in column-reverse
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isLoadingMore && continuationToken && onLoadMore) {
          onLoadMore();
        }
      },
      { root: container, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMessages, continuationToken, onLoadMore, isLoadingMore]);

  // Scroll to bottom: scrollTop=0 is visual bottom in column-reverse
  const scrollToBottom = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Scroll to highlighted message
  useEffect(() => {
    if (highlightMessageId && messages.length > 0) {
      const el = messageRefs.current.get(highlightMessageId);
      if (el) {
        const timer = setTimeout(() => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [highlightMessageId, messages]);

  const skeletonCount = 10;

  // Hide member list on mobile or when explicitly disabled
  const shouldShowMemberList = showMemberList && !isMobile && memberListComponent;

  if (isLoading) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "row",
          width: "100%",
        }}
      >
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            p: 2,
          }}
        >
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <MessageSkeleton key={i} />
          ))}
        </Box>
        {shouldShowMemberList && memberListComponent}
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "row",
          width: "100%",
        }}
      >
        <Box
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 2,
          }}
        >
          <Typography color="error">Error loading messages</Typography>
        </Box>
        {shouldShowMemberList && memberListComponent}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "row",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      {/* Message Area */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          position: "relative",
        }}
      >
        {messages.length > 0 ? (
          <Box
            ref={scrollContainerRef}
            data-testid="scroll-container"
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column-reverse",
            }}
          >
            {/* Bottom sentinel: first in DOM = visual bottom in column-reverse */}
            <Box ref={bottomSentinelRef} sx={{ height: '1px', flexShrink: 0 }} />

            {/* Messages newest-first; column-reverse shows oldest at top */}
            {messages.map((message, index) => {
              const isHighlighted = highlightMessageId === message.id;
              // Show divider before the last-read message in DOM.
              // In column-reverse, "before in DOM" = "below visually",
              // placing the divider between last-read (above) and first-unread (below).
              const showDividerBefore =
                unreadCount > 0 && lastReadIndex > 0 && index === lastReadIndex;

              return (
                <React.Fragment key={message.id}>
                  {showDividerBefore && (
                    <UnreadMessageDivider unreadCount={unreadCount} />
                  )}
                  <div>
                    <div
                      data-message-id={message.id}
                      ref={(el) => {
                        if (el) messageRefs.current.set(message.id, el);
                        else messageRefs.current.delete(message.id);
                      }}
                    >
                      <MessageComponent
                        message={message}
                        isAuthor={message.authorId === authorId}
                        isSearchHighlight={isHighlighted}
                        contextId={contextId}
                        communityId={communityId}
                        onOpenThread={onOpenThread}
                        contextType={directMessageGroupId ? VoiceSessionType.Dm : VoiceSessionType.Channel}
                      />
                    </div>
                  </div>
                </React.Fragment>
              );
            })}

            {/* Loading skeleton at DOM end = visual top */}
            {isLoadingMore && (
              <Box sx={{ p: 2, textAlign: "center" }}>
                <MessageSkeleton />
                <MessageSkeleton />
                <MessageSkeleton />
              </Box>
            )}

            {/* Top sentinel: last in DOM = visual top */}
            <Box ref={topSentinelRef} sx={{ height: '1px', flexShrink: 0 }} />
          </Box>
        ) : (
          <Box
            sx={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Typography color="text.secondary">
              {emptyStateMessage}
            </Typography>
          </Box>
        )}

        {/* Other user typing indicator */}
        <TypingIndicator channelId={channelId} directMessageGroupId={directMessageGroupId} currentUserId={authorId} />


        {/* Input rendered outside scroll container — stable DOM, never unmounted by message changes */}
        <Box sx={{ flexShrink: 0 }}>
          {messageInput}
        </Box>

        {!atBottom && (
          <Fab
            size="small"
            onClick={scrollToBottom}
            sx={{
              position: "absolute",
              bottom: 80,
              right: 16,
              backgroundColor: "primary.main",
              "&:hover": { backgroundColor: "primary.dark" },
            }}
          >
            <KeyboardArrowDownIcon />
          </Fab>
        )}
      </Box>

      {/* Member List */}
      {shouldShowMemberList && memberListComponent}
    </Box>
  );
};

export default MessageContainer;
