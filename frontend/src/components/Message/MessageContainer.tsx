import React, { useMemo } from "react";
import MessageComponent from "./MessageComponent";
import { Box, Typography, Fab } from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import MessageSkeleton from "./MessageSkeleton";
import { UnreadMessageDivider } from "./UnreadMessageDivider";
import type { Message } from "../../types/message.type";
import { useMessageVisibility } from "../../hooks/useMessageVisibility";
import { useReadReceipts } from "../../hooks/useReadReceipts";
import { useResponsive } from "../../hooks/useResponsive";
import { useBidirectionalScroll } from "../../hooks/useBidirectionalScroll";
import { useAnchoredModeTransition } from "../../hooks/useAnchoredModeTransition";
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

  // Bidirectional pagination (anchored mode)
  onLoadNewer?: () => Promise<void>;
  isLoadingNewer?: boolean;
  hasNewer?: boolean;
  mode?: 'normal' | 'anchored';
  jumpToPresent?: () => void;

  // Message Input
  messageInput: React.ReactNode;

  // Member List
  memberListComponent?: React.ReactNode;
  showMemberList?: boolean;

  // Optional customization
  emptyStateMessage?: string;

  // Search highlight
  highlightMessageId?: string;
  highlightSeq?: number;

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
  onLoadNewer,
  isLoadingNewer,
  hasNewer,
  mode = 'normal',
  jumpToPresent,
  messageInput,
  memberListComponent,
  showMemberList = true,
  emptyStateMessage = "No messages yet. Start the conversation!",
  highlightMessageId,
  highlightSeq,
  contextId,
  communityId,
  onOpenThread,
  channelId,
  directMessageGroupId,
}) => {
  const { isMobile } = useResponsive();

  const {
    scrollContainerRef,
    bottomSentinelRef,
    topSentinelRef,
    messageRefs,
    atBottom,
    scrollToBottom,
  } = useBidirectionalScroll({
    messages,
    mode,
    highlightMessageId,
    highlightSeq,
    onLoadMore,
    isLoadingMore,
    continuationToken,
    onLoadNewer,
    isLoadingNewer,
    hasNewer,
  });

  useAnchoredModeTransition({
    mode,
    atBottom,
    hasNewer,
    isLoadingNewer,
    jumpToPresent,
    scrollContainerRef,
  });

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

            {/* Loading skeleton at visual bottom for newer messages (anchored mode) */}
            {isLoadingNewer && (
              <Box sx={{ p: 2, textAlign: "center" }}>
                <MessageSkeleton />
                <MessageSkeleton />
                <MessageSkeleton />
              </Box>
            )}

            <Box sx={{ px: 2, minHeight: 20 }} />

            {/* Messages newest-first; column-reverse shows oldest at top */}
            {messages.map((message, index) => {
              const isHighlighted = highlightMessageId === message.id;
              // Show divider before the last-read message in DOM.
              // In column-reverse, "before in DOM" = "below visually",
              // placing the divider between last-read (above) and first-unread (below).
              const showDividerBefore =
                unreadCount > 0 && lastReadIndex > 0 && index === lastReadIndex;

              // Composite key: when highlighted, include highlightSeq so React remounts
              // the element and restarts the CSS flash animation on re-clicks.
              const key = isHighlighted ? `${message.id}-hl-${highlightSeq}` : message.id;

              return (
                <React.Fragment key={key}>
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

        {/* Other user typing indicator — floats above input, no layout shift */}
        <Box sx={{ position: 'relative', height: 0, zIndex: 1 }}>
          <TypingIndicator channelId={channelId} directMessageGroupId={directMessageGroupId} currentUserId={authorId} />
        </Box>

        {/* Input rendered outside scroll container — stable DOM, never unmounted by message changes */}
        <Box sx={{ flexShrink: 0 }}>
          {messageInput}
        </Box>

        {mode === 'anchored' && jumpToPresent ? (
          <Fab
            variant="extended"
            size="small"
            onClick={jumpToPresent}
            data-testid="jump-to-present-fab"
            sx={{
              position: "absolute",
              bottom: 80,
              right: 16,
              backgroundColor: "primary.main",
              "&:hover": { backgroundColor: "primary.dark" },
              color: "primary.contrastText",
            }}
          >
            <KeyboardArrowDownIcon sx={{ mr: 0.5 }} />
            Jump to Present
          </Fab>
        ) : !atBottom && (
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
