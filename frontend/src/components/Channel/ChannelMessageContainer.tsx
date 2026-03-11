import React, { useState, useCallback } from "react";
import { Box, Typography, Paper, IconButton, Tooltip, Badge, Drawer } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import PushPinIcon from "@mui/icons-material/PushPin";
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
  membershipControllerFindAllForCommunityOptions,
  channelsControllerGetMentionableChannelsOptions,
  channelsControllerFindOneOptions,
  moderationControllerGetPinnedMessagesOptions,
} from "../../api-client/@tanstack/react-query.gen";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import ChannelNotificationMenu from "./ChannelNotificationMenu";
import { useAutoMarkNotificationsRead } from "../../hooks/useAutoMarkNotificationsRead";
import { useThreadPanel } from "../../contexts/ThreadPanelContext";
import { useVoice, VoiceSessionType } from "../../contexts/VoiceContext";
import { VOICE_BAR_HEIGHT } from "../../constants/layout";
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

  // Get communityId from props (mobile) or URL params (desktop)
  const { communityId: communityIdParam } = useParams<{
    communityId: string;
  }>();
  const communityId = communityIdProp || communityIdParam;

  // Get highlight message ID from URL params
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const highlightMessageId = searchParams.get("highlight");

  // Clear highlight param from URL immediately after capturing it.
  // useJumpToMessage stores it locally for scroll/flash (3s auto-clear).
  // Immediate URL clear allows re-clicking the same pinned message.
  React.useEffect(() => {
    if (highlightMessageId) {
      navigate(`/community/${communityId}/channel/${channelId}`, {
        replace: true,
      });
    }
  }, [highlightMessageId, communityId, channelId, navigate]);

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

  const handleOpenThread = useCallback((message: Message) => {
    setThreadParentMessage(message);
    openThread(message.id);
  }, [openThread]);

  const handleCloseThread = useCallback(() => {
    closeThread();
    setThreadParentMessage(null);
  }, [closeThread]);

  // Fetch channel data for header
  const { data: channel } = useQuery(channelsControllerFindOneOptions({ path: { id: channelId } }));

  // Auto-mark notifications as read when viewing this channel
  useAutoMarkNotificationsRead({
    contextType: VoiceSessionType.Channel,
    contextId: channelId,
  });

  // Fetch community members and channels for mention resolution
  const { data: memberData = [] } = useQuery({
    ...membershipControllerFindAllForCommunityOptions({ path: { communityId: communityId || "" } }),
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

  // Create member list component for the channel
  const memberListComponent = (
    <MemberListContainer
      contextType={VoiceSessionType.Channel}
      contextId={channelId}
      communityId={communityId}
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
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            # {channel?.name || 'Channel'}
          </Typography>
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
          sx: { width: 360 },
        }}
      >
        <PinnedMessagesPanel
          channelId={channelId}
          communityId={communityId || ""}
          onClose={() => setPinnedPanelOpen(false)}
          onMessageClick={(messageId) => {
            setPinnedPanelOpen(false);
            navigate(`/community/${communityId}/channel/${channelId}?highlight=${messageId}`);
          }}
        />
      </Drawer>

      {/* Thread Panel Drawer */}
      <Drawer
        anchor="right"
        open={!!openThreadId && !!threadParentMessage}
        onClose={handleCloseThread}
        PaperProps={{
          sx: {
            width: 400,
            height: '100dvh',
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
          />
        )}
      </Drawer>
    </Box>
  );
};

export default ChannelMessageContainer;
