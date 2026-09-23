import React, { useState, useCallback, useEffect } from "react";
import { Box, Typography, Paper, IconButton, Tooltip, Badge, Drawer } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import PushPinIcon from "@mui/icons-material/PushPin";
import LockIcon from "@mui/icons-material/Lock";
import MessageContainerWrapper from "../Message/MessageContainerWrapper";
import MemberListContainer from "../Message/MemberListContainer";
import MessageSearch from "../Message/MessageSearch";
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
import { VOICE_BAR_HEIGHT } from "../../constants/layout";
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

  // Search state
  const [searchAnchorEl, setSearchAnchorEl] = useState<HTMLElement | null>(null);
  const handleSearchOpen = (event: React.MouseEvent<HTMLElement>) => {
    setSearchAnchorEl(event.currentTarget);
  };
  const handleSearchClose = () => {
    setSearchAnchorEl(null);
  };

  // Pinned messages state
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false);
  const { data: pinnedMessages = [] } = useQuery(moderationControllerGetPinnedMessagesOptions({ path: { channelId } }));

  // Thread state
  const { openThreadId, openThread, closeThread } = useThreadPanel();
  const [threadParentMessage, setThreadParentMessage] = useState<Message | null>(null);
  const [pendingThreadParentId, setPendingThreadParentId] = useState<string | null>(null);

  const handleOpenThread = useCallback((message: Message) => {
    setPendingThreadParentId(null);
    setThreadParentMessage(message);
    openThread(message.id);
  }, [openThread]);

  const handleCloseThread = useCallback(() => {
    closeThread();
    setThreadParentMessage(null);
  }, [closeThread]);

  const threadOpen = !!openThreadId && !!threadParentMessage;
  useOverlayHistory(threadOpen, handleCloseThread, { enabled: shouldUseTouchUI });
  const closePinnedPanel = useCallback(() => setPinnedPanelOpen(false), []);
  useOverlayHistory(pinnedPanelOpen, closePinnedPanel, { enabled: shouldUseTouchUI });

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
                sx={{ fontSize: 'icon.lg', color: 'text.secondary', flexShrink: 0 }}
              />
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title={`Pinned messages (${pinnedMessages.length})`}>
              <IconButton size="small" onClick={() => setPinnedPanelOpen(true)}>
                <Badge badgeContent={pinnedMessages.length} color="primary" max={99}>
                  <PushPinIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title="Search messages">
              <IconButton size="small" onClick={handleSearchOpen}>
                <SearchIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <ChannelNotificationMenu
              channelId={channelId}
              channelName={channel?.name}
            />
          </Box>
        </Paper>
      )}

      {/* Message Search Popover */}
      <MessageSearch
        channelId={channelId}
        communityId={communityId || ""}
        anchorEl={searchAnchorEl}
        onClose={handleSearchClose}
      />

      {/* Messages */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <MessageContainerWrapper
          contextType={VoiceSessionType.Channel}
          contextId={channelId}
          communityId={communityId}
          useMessagesHook={() => messagesHookResult}
          userMentions={userMentions}
          channelMentions={channelMentions}
          onSendMessage={handleSendMessage}
          memberListComponent={memberListComponent}
          placeholder="Type a message... Use @ for members, @here, @channel"
          emptyStateMessage="No messages yet. Start the conversation!"
          highlightMessageId={messagesHookResult.highlightMessageId}
          onOpenThread={handleOpenThread}
        />
      </Box>

      {/* Pinned Messages Drawer */}
      <Drawer
        anchor="right"
        open={pinnedPanelOpen}
        onClose={() => setPinnedPanelOpen(false)}
        PaperProps={{
          sx: { width: 'min(360px, 100vw)' },
        }}
      >
        <PinnedMessagesPanel
          channelId={channelId}
          communityId={communityId || ""}
          onClose={() => setPinnedPanelOpen(false)}
          onMessageClick={(messageId) => {
            setPinnedPanelOpen(false);
            // On touch layouts the open panel owns the current history entry
            // (useOverlayHistory); replace it so back doesn't land on a dead entry.
            const navOptions = { replace: shouldUseTouchUI };
            const pinnedMsg = pinnedMessages.find(m => m.id === messageId);
            if (pinnedMsg?.parentMessageId) {
              // Thread reply: jump to parent message and open the thread panel
              setPendingThreadParentId(pinnedMsg.parentMessageId);
              navigate(`/community/${communityId}/channel/${channelId}?highlight=${pinnedMsg.parentMessageId}`, navOptions);
            } else {
              navigate(`/community/${communityId}/channel/${channelId}?highlight=${messageId}`, navOptions);
            }
          }}
        />
      </Drawer>

      {/* Thread Panel Drawer */}
      <Drawer
        anchor="right"
        open={threadOpen}
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
        {threadParentMessage && (
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
