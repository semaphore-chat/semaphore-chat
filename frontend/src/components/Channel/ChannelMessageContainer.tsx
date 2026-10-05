import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Typography, Paper, IconButton, Tooltip, Badge, Drawer } from "@mui/material";
import useMediaQuery from "@mui/material/useMediaQuery";
import SearchIcon from "@mui/icons-material/Search";
import PushPinIcon from "@mui/icons-material/PushPin";
import LockIcon from "@mui/icons-material/Lock";
import MessageContainerWrapper from "../Message/MessageContainerWrapper";
import MemberListContainer from "../Message/MemberListContainer";
import { MemberListDrawerButton } from "../Message/MemberListDrawerButton";
import MessageSearch from "../Message/MessageSearch";
import { MessageSearchPanel } from "../Message/MessageSearchPanel";
import { DockedSidePanel, DOCKED_PANEL_ATTR, type DockedPanelKind } from "./DockedSidePanel";
import { PinnedMessagesPanel } from "../Moderation";
import { ThreadPanel } from "../Thread";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useJumpToMessage } from "../../hooks/useJumpToMessage";
import { useMessageFileUpload } from "../../hooks/useMessageFileUpload";
import { useQuery } from "@tanstack/react-query";
import {
  channelsControllerGetMentionableChannelsOptions,
  channelsControllerFindOneOptions,
  moderationControllerGetPinnedMessagesOptions,
} from "../../api-client/@tanstack/react-query.gen";
import { useAllCommunityMembers } from "../../hooks/useAllCommunityMembers";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import ChannelNotificationMenu from "./ChannelNotificationMenu";
import { useAutoMarkNotificationsRead } from "../../hooks/useAutoMarkNotificationsRead";
import { useThreadPanel } from "../../contexts/ThreadPanelContext";
import { useVoice, VoiceSessionType } from "../../contexts/VoiceContext";
import { VOICE_BAR_HEIGHT, CHAT_COLUMN_MIN_WIDTH } from "../../constants/layout";
import { DEVICE_BREAKPOINTS } from "../../utils/breakpoints";
import { useResponsive } from "../../hooks/useResponsive";
import { useOverlayHistory } from "../../hooks/useOverlayHistory";
import type { UserMention, ChannelMention } from "../../utils/mentionParser";
import type { Message } from "../../types/message.type";

interface ChannelMessageContainerProps {
  channelId: string;
  /** Hide the built-in header (for mobile which has its own app bar) */
  hideHeader?: boolean;
  /** Optional communityId prop (for mobile where useParams is unavailable) */
  communityId?: string;
}

const ChannelMessageContainer: React.FC<ChannelMessageContainerProps> = ({
  channelId,
  hideHeader = false,
  communityId: communityIdProp,
}) => {
  const { user } = useCurrentUser();
  const authorId = user?.id || "";

  const { isConnected: voiceConnected } = useVoice();
  // Phone: the thread is a full-screen layer. Touch layouts: back closes the
  // thread / pinned layer before leaving the channel. (Both are false on
  // Electron, which always uses the desktop layout.)
  const { isMobile, shouldUseTouchUI } = useResponsive();

  // Wide desktop (>= 1200px, web or Electron): threads, pins and search open
  // in a docked, non-modal side panel next to the messages. Narrower desktop
  // windows (Electron down to its 820px minimum) keep the drawers / popover:
  // the rail, channel list and a 400px panel would squeeze the chat column
  // under ~400px. The phone / tablet layouts (hideHeader) never dock.
  const isWideViewport = useMediaQuery(`(min-width: ${DEVICE_BREAKPOINTS.DESKTOP}px)`);
  const docked = isWideViewport && !isMobile && !hideHeader;

  // Get communityId from props (mobile) or URL params (desktop)
  const { communityId: communityIdParam } = useParams<{
    communityId: string;
  }>();
  const communityId = communityIdProp || communityIdParam;

  // Get highlight message ID from URL params
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const highlightMessageId = searchParams.get("highlight");

  const { handleSendMessage } = useMessageFileUpload({
    contextType: VoiceSessionType.Channel,
    contextId: channelId,
    authorId,
  });

  // The element that opened the docked panel, to return focus to on close.
  // Swapping content from inside the panel (a pinned thread reply opening its
  // thread) keeps the original trigger.
  const panelTriggerRef = useRef<HTMLElement | null>(null);
  const rememberPanelTrigger = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.closest(`[${DOCKED_PANEL_ATTR}]`)) {
      panelTriggerRef.current = active;
    }
  }, []);

  // Search state: a popover in narrow windows, the docked panel when wide.
  const [searchAnchorEl, setSearchAnchorEl] = useState<HTMLElement | null>(null);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const handleSearchClose = () => {
    setSearchAnchorEl(null);
  };
  const closeSearchPanel = useCallback(() => setSearchPanelOpen(false), []);

  // Pinned messages state
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false);
  const { data: pinnedMessages = [] } = useQuery(moderationControllerGetPinnedMessagesOptions({ path: { channelId } }));

  // Thread state
  const { openThreadId, openThread, closeThread } = useThreadPanel();
  const [threadParentMessage, setThreadParentMessage] = useState<Message | null>(null);
  const [pendingThreadParentId, setPendingThreadParentId] = useState<string | null>(null);

  // One side panel at a time: opening one swaps out the others.
  const handleOpenThread = useCallback((message: Message) => {
    rememberPanelTrigger();
    setPendingThreadParentId(null);
    setPinnedPanelOpen(false);
    setSearchPanelOpen(false);
    setThreadParentMessage(message);
    openThread(message.id);
  }, [openThread, rememberPanelTrigger]);

  const handleCloseThread = useCallback(() => {
    closeThread();
    setThreadParentMessage(null);
  }, [closeThread]);

  const threadOpen = !!openThreadId && !!threadParentMessage;
  // Back closes a modal layer on touch layouts; the docked panel isn't a layer.
  useOverlayHistory(threadOpen, handleCloseThread, { enabled: shouldUseTouchUI && !docked });
  const closePinnedPanel = useCallback(() => setPinnedPanelOpen(false), []);
  useOverlayHistory(pinnedPanelOpen, closePinnedPanel, { enabled: shouldUseTouchUI && !docked });

  const togglePinnedPanel = () => {
    if (docked && pinnedPanelOpen) {
      setPinnedPanelOpen(false);
      return;
    }
    rememberPanelTrigger();
    if (threadOpen) handleCloseThread();
    setSearchPanelOpen(false);
    setPinnedPanelOpen(true);
  };

  const handleSearchButton = (event: React.MouseEvent<HTMLElement>) => {
    if (!docked) {
      setSearchAnchorEl(event.currentTarget);
      return;
    }
    if (searchPanelOpen) {
      setSearchPanelOpen(false);
      return;
    }
    rememberPanelTrigger();
    if (threadOpen) handleCloseThread();
    setPinnedPanelOpen(false);
    setSearchPanelOpen(true);
  };

  // Threads and the pinned list belong to one channel: close them when the
  // channel changes (this component stays mounted across channel switches).
  // Search stays open: its "All Channels" results lead to other channels.
  const [prevChannelId, setPrevChannelId] = useState(channelId);
  if (prevChannelId !== channelId) {
    setPrevChannelId(channelId);
    setPinnedPanelOpen(false);
    setThreadParentMessage(null);
    setPendingThreadParentId(null);
  }
  const lastChannelRef = useRef(channelId);
  useEffect(() => {
    if (lastChannelRef.current === channelId) return;
    lastChannelRef.current = channelId;
    closeThread();
  }, [channelId, closeThread]);

  const dockedPanel: DockedPanelKind | null = !docked
    ? null
    : threadOpen
      ? "thread"
      : pinnedPanelOpen
        ? "pins"
        : searchPanelOpen
          ? "search"
          : null;

  // Return focus to the trigger when the docked panel closes, if focus went
  // with it (to <body>). A channel switch that closed it leaves focus alone.
  const prevDockedPanelRef = useRef(dockedPanel);
  useEffect(() => {
    const wasOpen = prevDockedPanelRef.current;
    prevDockedPanelRef.current = dockedPanel;
    if (!wasOpen || dockedPanel) return;
    const trigger = panelTriggerRef.current;
    panelTriggerRef.current = null;
    const active = document.activeElement;
    if (trigger?.isConnected && (!active || active === document.body)) {
      trigger.focus();
    }
  }, [dockedPanel]);

  // Fetch channel data for header
  const { data: channel } = useQuery(channelsControllerFindOneOptions({ path: { id: channelId } }));

  // Auto-mark notifications as read when viewing this channel
  useAutoMarkNotificationsRead({
    contextType: VoiceSessionType.Channel,
    contextId: channelId,
  });

  // Fetch community members and channels for mention resolution
  const { data: memberData = [] } = useAllCommunityMembers(communityId || "", {
    enabled: !!communityId,
  });
  const { data: channelData = [] } = useQuery({
    ...channelsControllerGetMentionableChannelsOptions({ path: { communityId: communityId || "" } }),
    enabled: !!communityId,
  });

  // Convert to mention format
  const userMentions: UserMention[] = React.useMemo(() =>
    memberData.map((member) => ({
      id: member.user!.id,
      username: member.user!.username,
      displayName: member.user!.displayName || undefined,
    })), [memberData]);

  const channelMentions: ChannelMention[] = React.useMemo(() =>
    channelData.map((channel) => ({
      id: channel.id,
      name: channel.name,
    })), [channelData]);

  // Get messages using the jump-to-message hook (supports anchored mode for pinned/search/notification links)
  const messagesHookResult = useJumpToMessage('channel', channelId, highlightMessageId || undefined);
  const { isJumpPending } = messagesHookResult;

  // Clear the highlight param from the URL once the jump has settled (target
  // loaded, in the normal or anchored window). useJumpToMessage keeps the id
  // locally for scroll/flash, and clearing lets the same pinned message be
  // re-clicked. Clearing earlier would drop a cold deep link on the floor.
  useEffect(() => {
    if (highlightMessageId && !isJumpPending) {
      navigate(`/community/${communityId}/channel/${channelId}`, {
        replace: true,
      });
    }
  }, [highlightMessageId, isJumpPending, communityId, channelId, navigate]);

  // When a pinned thread reply is clicked, we jump to the parent and then open the thread
  useEffect(() => {
    if (!pendingThreadParentId) return;
    const parentMsg = messagesHookResult.messages.find((m: Message) => m.id === pendingThreadParentId);
    if (parentMsg) {
      handleOpenThread(parentMsg);
      setPendingThreadParentId(null);
    }
  }, [pendingThreadParentId, messagesHookResult.messages, handleOpenThread]);

  // A pinned message was clicked: jump to it. The drawer closes; the docked
  // panel stays open so you can go through several pins. A pinned thread
  // reply jumps to its parent and then opens the thread (swapping the panel).
  const handlePinnedMessageClick = (messageId: string) => {
    if (!docked) setPinnedPanelOpen(false);
    // On touch layouts the open panel owns the current history entry
    // (useOverlayHistory); replace it so back doesn't land on a dead entry.
    const navOptions = { replace: shouldUseTouchUI && !docked };
    const pinnedMsg = pinnedMessages.find(m => m.id === messageId);
    if (pinnedMsg?.parentMessageId) {
      // Thread reply: jump to parent message and open the thread panel
      setPendingThreadParentId(pinnedMsg.parentMessageId);
      navigate(`/community/${communityId}/channel/${channelId}?highlight=${pinnedMsg.parentMessageId}`, navOptions);
    } else {
      navigate(`/community/${communityId}/channel/${channelId}?highlight=${messageId}`, navOptions);
    }
  };

  // Create member list component for the channel
  const memberListComponent = (
    <MemberListContainer
      contextType={VoiceSessionType.Channel}
      contextId={channelId}
      communityId={communityId}
      isPrivate={channel?.isPrivate}
    />
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Channel Header - hidden on mobile which has its own app bar */}
      {!hideHeader && (
        <Paper
          elevation={0}
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            px: 2,
            py: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Typography variant="h6" noWrap sx={{ fontWeight: 600 }}>
              # {channel?.name || 'Channel'}
            </Typography>
            {channel?.isPrivate && (
              <LockIcon
                aria-label="Private channel"
                titleAccess="Private channel"
                sx={{ fontSize: 'icon.lg', color: 'text.secondary', flexShrink: 0 }}
              />
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title={`Pinned messages (${pinnedMessages.length})`}>
              <IconButton
                size="small"
                onClick={togglePinnedPanel}
                aria-expanded={docked ? dockedPanel === "pins" : undefined}
              >
                <Badge badgeContent={pinnedMessages.length} color="primary" max={99}>
                  <PushPinIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title="Search messages">
              <IconButton
                size="small"
                onClick={handleSearchButton}
                aria-expanded={docked ? dockedPanel === "search" : undefined}
              >
                <SearchIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <ChannelNotificationMenu
              channelId={channelId}
              channelName={channel?.name}
            />
            <MemberListDrawerButton
              contextType={VoiceSessionType.Channel}
              contextId={channelId}
              communityId={communityId}
              isPrivate={channel?.isPrivate}
            />
          </Box>
        </Paper>
      )}

      {/* Message Search Popover (narrow desktop windows) */}
      {!docked && (
        <MessageSearch
          channelId={channelId}
          communityId={communityId || ""}
          anchorEl={searchAnchorEl}
          onClose={handleSearchClose}
        />
      )}

      {/* Messages, and the docked side panel on wide desktop */}
      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
        <Box sx={{ flex: 1, minWidth: docked ? CHAT_COLUMN_MIN_WIDTH : 0, overflow: 'hidden' }}>
          <MessageContainerWrapper
            contextType={VoiceSessionType.Channel}
            contextId={channelId}
            communityId={communityId}
            useMessagesHook={() => messagesHookResult}
            userMentions={userMentions}
            channelMentions={channelMentions}
            onSendMessage={handleSendMessage}
            // The open side panel takes the member list's place (like Discord):
            // at 1200px there's no room for chat, members and the panel.
            memberListComponent={dockedPanel ? undefined : memberListComponent}
            placeholder={channel?.name ? `Message #${channel.name}` : "Message this channel"}
            emptyStateMessage="No messages yet. Start the conversation!"
            highlightMessageId={messagesHookResult.highlightMessageId}
            onOpenThread={handleOpenThread}
          />
        </Box>

        {dockedPanel && (
          <DockedSidePanel
            label={dockedPanel === "thread" ? "Thread" : dockedPanel === "pins" ? "Pinned messages" : "Search messages"}
            kind={dockedPanel}
            onClose={
              dockedPanel === "thread" ? handleCloseThread : dockedPanel === "pins" ? closePinnedPanel : closeSearchPanel
            }
          >
            {dockedPanel === "thread" && threadParentMessage && (
              <ThreadPanel
                key={threadParentMessage.id}
                parentMessage={threadParentMessage}
                channelId={channelId}
                communityId={communityId}
                docked
              />
            )}
            {dockedPanel === "pins" && (
              <PinnedMessagesPanel
                channelId={channelId}
                communityId={communityId || ""}
                onClose={closePinnedPanel}
                onMessageClick={handlePinnedMessageClick}
              />
            )}
            {dockedPanel === "search" && (
              <MessageSearchPanel
                channelId={channelId}
                communityId={communityId || ""}
                onClose={closeSearchPanel}
              />
            )}
          </DockedSidePanel>
        )}
      </Box>

      {/* Pinned Messages Drawer (narrow windows) */}
      <Drawer
        anchor="right"
        open={!docked && pinnedPanelOpen}
        onClose={() => setPinnedPanelOpen(false)}
        PaperProps={{
          sx: { width: 'min(360px, 100vw)' },
        }}
      >
        <PinnedMessagesPanel
          channelId={channelId}
          communityId={communityId || ""}
          onClose={() => setPinnedPanelOpen(false)}
          onMessageClick={handlePinnedMessageClick}
        />
      </Drawer>

      {/* Thread Panel Drawer (phone, tablet and narrow desktop windows) */}
      <Drawer
        anchor="right"
        open={!docked && threadOpen}
        onClose={handleCloseThread}
        PaperProps={{
          sx: {
            width: isMobile ? '100vw' : 'min(400px, 100vw)',
            height: 'var(--full-dvh, 100dvh)',
            overflow: 'hidden',
            paddingBottom: voiceConnected ? `${VOICE_BAR_HEIGHT}px` : 0,
          },
        }}
      >
        {!docked && threadParentMessage && (
          <ThreadPanel
            parentMessage={threadParentMessage}
            channelId={channelId}
            communityId={communityId}
            fullScreen={isMobile}
          />
        )}
      </Drawer>
    </Box>
  );
};

export default ChannelMessageContainer;
