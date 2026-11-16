import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { refreshFloatDockRegion, useFloatRegionRef } from "../../hooks/useFloatDockRegion";
import { Box, Fab } from "@mui/material";
import { visuallyHidden } from "@mui/utils";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { useQueryClient } from "@tanstack/react-query";
import MessageSkeleton from "./MessageSkeleton";
import ListState from "../Common/ListState";
import EmptyState from "../Common/EmptyState";
import { useNavigate } from "react-router-dom";
import BlockIcon from "@mui/icons-material/Block";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import { getHttpStatus } from "../../utils/httpError";

/** "No messages yet. Start the conversation!" -> ["No messages yet", "Start the conversation!"] */
function splitFirstSentence(text: string): [string, string] {
  const match = /^(.+?)\.\s+(.+)$/.exec(text);
  return match ? [match[1], match[2]] : [text, ""];
}
import VirtualMessageList, { type VirtualMessageListHandle } from "./VirtualMessageList";
import { useEditRequest } from "../../contexts/EditRequestContext";
import type { Message } from "../../types/message.type";
import { useReadMarks } from "../../data/chat/useReadMarks";
import { useResponsive } from "../../hooks/useResponsive";
import { useAnchoredModeTransition } from "../../hooks/useAnchoredModeTransition";
import { useMessageListAnnouncer } from "../../hooks/useMessageListAnnouncer";
import TypingIndicator from "./TypingIndicator";

/** Gap between the composer's top edge and the FAB. */
const FAB_GAP = 16;
/** Before the composer is measured (or without ResizeObserver). */
const FALLBACK_FAB_BOTTOM = 80;

/**
 * Tracks an element's height with a ResizeObserver. Returns 0 until measured
 * (and stays 0 where ResizeObserver doesn't exist). Pass the element via
 * state/callback ref so the observer follows remounts.
 */
function useElementHeight(el: HTMLElement | null): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const initial = el.getBoundingClientRect().height;
    if (initial > 0) setHeight(Math.round(initial));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.borderBoxSize?.[0];
      setHeight(Math.round(box ? box.blockSize : entry.contentRect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return height;
}

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

  // Live-edge detachment (normal mode): deep scrollback evicted the newest
  // page, so the loaded bottom is not the present (#404).
  isDetachedFromPresent?: boolean;
  resetToPresent?: () => Promise<void>;

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
  onQuoteReply?: (message: Message) => void;

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
  isDetachedFromPresent,
  resetToPresent,
  messageInput,
  memberListComponent,
  showMemberList = true,
  emptyStateMessage = "No messages yet. Start the conversation!",
  highlightMessageId,
  highlightSeq,
  contextId,
  communityId,
  onOpenThread,
  onQuoteReply,
  channelId,
  directMessageGroupId,
}) => {
  const { isMobile, isTabletPortrait, isNarrowDesktop } = useResponsive();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [emptyTitle, emptyDescription] = splitFirstSentence(emptyStateMessage);

  // The message query lives in the parent's hook; rather than plumbing a
  // refetch through every container, "Try again" refetches whatever active
  // query is in an error state (i.e. the one that produced `error`).
  const handleRetry = useCallback(() => {
    void queryClient.refetchQueries({
      type: "active",
      predicate: (query) => query.state.status === "error",
    });
  }, [queryClient]);

  // Context identity (channel or DM group) — used for read receipts and to
  // reset scroll positioning when switching contexts.
  const contextKey = channelId || directMessageGroupId;

  // The messages prop arrives newest-first (useMessages contract). Render
  // oldest-first so DOM order matches chronological order — native text
  // selection follows DOM order, so this is what makes cross-message
  // selection highlight correctly.
  const orderedMessages = useMemo(() => [...messages].reverse(), [messages]);

  // VirtualMessageList is the single renderer for both normal and anchored
  // mode — virtua owns scroll position, prepend/append handling,
  // stick-to-bottom (normal mode only), and anchored initial centering /
  // newer-direction pagination.
  const virtualListRef = useRef<VirtualMessageListHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scrollToBottom = useCallback(() => {
    virtualListRef.current?.scrollToBottom();
  }, []);

  // ↑-to-edit: bring the requested message into view so its row mounts and
  // opens its edit form.
  const { request: editRequest } = useEditRequest();
  useEffect(() => {
    if (editRequest) virtualListRef.current?.scrollToMessage(editRequest.messageId);
  }, [editRequest]);

  // scrollToBottom/atBottom are routed through refs so the deferred
  // detached->live scroll effect below always calls/reads the latest values
  // without needing to be re-declared as a dependency on every render.
  const scrollToBottomRef = useRef(scrollToBottom);
  const atBottomRef = useRef(atBottom);
  useLayoutEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
    atBottomRef.current = atBottom;
  });

  // Throttled aria-live announcement for new incoming messages arriving
  // while the reader is scrolled away from the live edge — wired off the
  // same `atBottom` signal the FAB/unread logic above already uses.
  const liveAnnouncement = useMessageListAnnouncer({
    orderedMessages,
    atBottom,
    authorId,
    contextKey,
    enabled: !isLoading,
  });

  // Escape (pressed while a message row has roving focus) returns focus to
  // the composer. The composer is rendered as `messageInput` below —
  // structurally always the sibling Box right after the list — so it's
  // located via a DOM query relative to that Box rather than threading a
  // ref through every page that constructs a <MessageInput />.
  const messageInputBoxRef = useRef<HTMLDivElement>(null);
  // The composer grows (reply banner, file tray, multi-line draft), so the
  // floating FABs track its measured height instead of a fixed offset.
  const [composerBoxEl, setComposerBoxEl] = useState<HTMLDivElement | null>(null);
  // The message column and composer also define where the desktop voice
  // float card docks (above the composer, off the member list / side panel).
  const floatChatRegionRef = useFloatRegionRef('chat');
  // The chat column's height, published as --chat-column-height so the
  // composer can cap the draft input at a share of it (MessageInput).
  const [chatColumnEl, setChatColumnEl] = useState<HTMLDivElement | null>(null);
  const chatColumnHeight = useElementHeight(chatColumnEl);
  const chatRegionRef = useCallback((el: HTMLDivElement | null) => {
    setChatColumnEl(el);
    floatChatRegionRef(el);
  }, [floatChatRegionRef]);
  const composerRegionRef = useFloatRegionRef('composer', { observe: false });
  const composerBoxRef = useCallback((el: HTMLDivElement | null) => {
    messageInputBoxRef.current = el;
    setComposerBoxEl(el);
    composerRegionRef(el);
  }, [composerRegionRef]);
  const composerHeight = useElementHeight(composerBoxEl);
  // The composer's top bounds the float card's dock region; it moves as the
  // composer grows (multi-line draft, reply banner, file tray).
  useEffect(() => {
    refreshFloatDockRegion();
  }, [composerHeight]);
  const fabBottom = composerHeight > 0 ? composerHeight + FAB_GAP : FALLBACK_FAB_BOTTOM;

  const handleEscapeToInput = useCallback(() => {
    const root = messageInputBoxRef.current;
    const target = root?.querySelector<HTMLElement>(
      'textarea, [contenteditable="true"]',
    );
    target?.focus();
  }, []);

  useAnchoredModeTransition({
    mode,
    atBottom,
    hasNewer,
    isLoadingNewer,
    jumpToPresent,
  });

  const { handleDetachedJumpToPresent, handleVisibleRangeChange, unreadCount, lastReadIndex } = useReadMarks({
    orderedMessages,
    isLoading,
    channelId,
    directMessageGroupId,
    contextKey,
    isDetachedFromPresent,
    resetToPresent,
    scrollToBottomRef,
    atBottomRef,
  });

  const skeletonCount = 10;

  // Hide member list on mobile or when explicitly disabled. Below 1024px
  // (tablet portrait) the split view keeps at most two columns, so the list
  // isn't inline there either — the tablet app bar opens it as an overlay.
  // Electron is always the desktop layout, and below 1024px there the rail
  // and channel sidebar leave no room for it either: the chat header's
  // members button (MemberListDrawerButton) opens it as a drawer instead.
  const shouldShowMemberList =
    showMemberList && !isMobile && !isTabletPortrait && !isNarrowDesktop && memberListComponent;

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
    const errorStatus = getHttpStatus(error);
    const isDm = !!directMessageGroupId && !channelId;
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
          {errorStatus === 404 || errorStatus === 403 ? (
            // Retrying can't fix a missing or off-limits conversation, and
            // it isn't a connection problem — say what happened and offer a
            // way out instead of "Try again".
            <EmptyState
              icon={
                errorStatus === 404 ? (
                  <SearchOffIcon sx={{ fontSize: "icon.6xl" }} />
                ) : (
                  <BlockIcon sx={{ fontSize: "icon.6xl" }} />
                )
              }
              title={
                errorStatus === 404
                  ? `${isDm ? "Conversation" : "Channel"} not found`
                  : `You don't have access to this ${isDm ? "conversation" : "channel"}`
              }
              description={
                errorStatus === 404
                  ? "It may have been deleted, or the link is wrong."
                  : isDm
                    ? "You're not a member of this conversation."
                    : "It may be private, or you may have been removed from this community."
              }
              action={{ label: "Go to home", onClick: () => navigate("/") }}
            />
          ) : (
            <ListState
              isLoading={false}
              error={error}
              onRetry={handleRetry}
              isEmpty
              errorTitle="Couldn't load messages"
            />
          )}
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
        ref={chatRegionRef}
        style={chatColumnHeight > 0 ? ({ '--chat-column-height': `${chatColumnHeight}px` } as React.CSSProperties) : undefined}
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          position: "relative",
          minWidth: 0,
        }}
      >
        {messages.length > 0 ? (
          <VirtualMessageList
            ref={virtualListRef}
            orderedMessages={orderedMessages}
            authorId={authorId}
            mode={mode}
            isLoadingMore={isLoadingMore}
            continuationToken={continuationToken}
            onLoadMore={onLoadMore}
            onLoadNewer={onLoadNewer}
            isLoadingNewer={isLoadingNewer}
            hasNewer={hasNewer}
            unreadCount={unreadCount}
            lastReadIndex={lastReadIndex}
            highlightMessageId={highlightMessageId}
            highlightSeq={highlightSeq}
            contextId={contextId}
            communityId={communityId}
            directMessageGroupId={directMessageGroupId}
            onOpenThread={onOpenThread}
            onQuoteReply={onQuoteReply}
            resetKey={contextKey}
            onAtBottomChange={setAtBottom}
            onVisibleRangeChange={handleVisibleRangeChange}
            onEscapeToInput={handleEscapeToInput}
          />
        ) : (
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Same EmptyState as the other lists: the message's first
                sentence is the title, the rest the description. */}
            <EmptyState
              variant={directMessageGroupId && !channelId ? "dm" : "messages"}
              title={emptyTitle}
              description={emptyDescription || " "}
            />
          </Box>
        )}

        {/* Other user typing indicator — floats above input, no layout shift */}
        <Box sx={{ position: 'relative', height: 0, zIndex: 1 }}>
          <TypingIndicator channelId={channelId} directMessageGroupId={directMessageGroupId} currentUserId={authorId} />
        </Box>

        {/* Input rendered outside scroll container — stable DOM, never unmounted by message changes */}
        <Box ref={composerBoxRef} sx={{ flexShrink: 0 }}>
          {messageInput}
        </Box>

        {/* Polite live region for new-message announcements (throttled,
            coalescing — see useMessageListAnnouncer). Always mounted so
            screen readers pick up mutations; visually hidden. */}
        <Box
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="message-list-live-region"
          sx={visuallyHidden}
        >
          {liveAnnouncement}
        </Box>

        {mode === 'anchored' && jumpToPresent ? (
          <Fab
            variant="extended"
            size="small"
            onClick={jumpToPresent}
            data-testid="jump-to-present-fab"
            style={{ bottom: fabBottom }}
            sx={{
              position: "absolute",
              right: 16,
              backgroundColor: "primary.main",
              "&:hover": { backgroundColor: "primary.dark" },
              color: "primary.contrastText",
            }}
          >
            <KeyboardArrowDownIcon sx={{ mr: 0.5 }} />
            Jump to Present
          </Fab>
        ) : mode === 'normal' && isDetachedFromPresent && resetToPresent ? (
          <Fab
            variant="extended"
            size="small"
            onClick={handleDetachedJumpToPresent}
            data-testid="jump-to-present-fab"
            style={{ bottom: fabBottom }}
            sx={{
              position: "absolute",
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
            aria-label="Scroll to latest messages"
            style={{ bottom: fabBottom }}
            sx={{
              position: "absolute",
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
