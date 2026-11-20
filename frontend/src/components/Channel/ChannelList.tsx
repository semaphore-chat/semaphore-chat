import React, { useMemo } from "react";
import { Channel as ChannelComponent } from "./Channel";
import { List, Typography, Box, alpha, useTheme, Skeleton } from "@mui/material";
import { Tag as TextIcon, VolumeUp as VoiceIcon } from "@mui/icons-material";
import type { Channel } from "../../types/channel.type";
import { ErrorState } from "../Common/ListState";
import { useNavigate, useParams } from "react-router-dom";
import { useUnreadSummary } from "../../data/unread";
import { useCommunityChannels } from "../../data/channels";
import { useRegisterSidebarNav, type SidebarNav } from "../../contexts/ShortcutsContext";
import { ariaKeyShortcuts } from "../../utils/shortcuts";

interface ChannelListProps {
  communityId: string;
}

interface CategoryHeaderProps {
  icon: React.ReactNode;
  label: string;
}

const CategoryHeader: React.FC<CategoryHeaderProps> = ({ icon, label }) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 2,
        py: 1,
        mt: 1,
        mb: 0.5,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          color: theme.palette.mode === "dark"
            ? alpha(theme.palette.primary.light, 0.7)
            : theme.palette.primary.main,
        }}
      >
        {icon}
      </Box>
      <Typography
        variant="caption"
        sx={{
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "text.secondary",
        }}
      >
        {label}
      </Typography>
    </Box>
  );
};

const LoadingSkeleton: React.FC = () => (
  <Box sx={{ px: 2, py: 1 }}>
    <Skeleton variant="text" width="40%" height={16} sx={{ mb: 1 }} />
    {[1, 2, 3].map((i) => (
      <Skeleton key={i} variant="rounded" height={32} sx={{ mb: 0.5 }} />
    ))}
  </Box>
);

const ChannelList: React.FC<ChannelListProps> = ({ communityId }) => {
  // Text and voice channels, each in position order
  const {
    all: channels,
    text: textChannels,
    voice: voiceChannels,
    isLoading,
    error,
    refetch,
  } = useCommunityChannels(communityId);

  // Alt+↑/↓ walk the text channels in sidebar order (voice channels would
  // join the call, so they're skipped).
  const navigate = useNavigate();
  const { channelId: currentChannelId } = useParams<{ channelId: string }>();
  const unreadSummary = useUnreadSummary();
  const sidebarNav = useMemo<SidebarNav>(() => {
    return {
      kind: "channel",
      items: textChannels.map((c: Channel) => ({
        id: c.id,
        label: `#${c.name}`,
        unread: c.id !== currentChannelId && unreadSummary.channel(c.id).unread > 0,
      })),
      currentId: currentChannelId,
      select: (id: string) => navigate(`/community/${communityId}/channel/${id}`),
    };
  }, [textChannels, currentChannelId, communityId, navigate, unreadSummary]);
  useRegisterSidebarNav(sidebarNav);

  if (isLoading) return <LoadingSkeleton />;

  if (error) {
    return (
      <ErrorState
        size="compact"
        title="Couldn't load channels"
        description="Check your connection and try again."
        onRetry={() => void refetch()}
      />
    );
  }

  if (!channels || channels.length === 0) {
    return (
      <Box sx={{ px: 2, py: 3, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          No channels yet
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      component="nav"
      aria-label="Channels"
      aria-keyshortcuts={ariaKeyShortcuts(["prevChannel", "nextChannel", "prevUnread", "nextUnread"])}
      sx={{ width: "100%" }}
    >
      {/* Text Channels Section */}
      {textChannels.length > 0 && (
        <>
          <CategoryHeader
            icon={<TextIcon sx={{ fontSize: 'icon.md' }} />}
            label="Text Channels"
          />
          <List sx={{ padding: 0 }}>
            {textChannels.map((channel: Channel) => (
              <ChannelComponent key={channel.id} channel={channel} />
            ))}
          </List>
        </>
      )}

      {/* Voice Channels Section */}
      {voiceChannels.length > 0 && (
        <>
          <CategoryHeader
            icon={<VoiceIcon sx={{ fontSize: 'icon.md' }} />}
            label="Voice Channels"
          />
          <List sx={{ padding: 0 }}>
            {voiceChannels.map((channel: Channel) => (
              <ChannelComponent key={channel.id} channel={channel} />
            ))}
          </List>
        </>
      )}
    </Box>
  );
};

export default ChannelList;
