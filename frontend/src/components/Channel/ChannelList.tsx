import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { channelsControllerFindAllForCommunityOptions } from "../../api-client/@tanstack/react-query.gen";
import { Channel as ChannelComponent } from "./Channel";
import { List, Typography, Box, alpha, useTheme, Skeleton } from "@mui/material";
import { Tag as TextIcon, VolumeUp as VoiceIcon } from "@mui/icons-material";
import { ChannelType, Channel } from "../../types/channel.type";

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
  const {
    data: channels,
    isLoading,
    error,
  } = useQuery(channelsControllerFindAllForCommunityOptions({ path: { communityId } }));

  // Separate and sort channels by type
  const { textChannels, voiceChannels } = useMemo(() => {
    if (!channels) return { textChannels: [], voiceChannels: [] };

    const text = channels
      .filter((c: Channel) => c.type === ChannelType.TEXT)
      .sort((a: Channel, b: Channel) => (a.position ?? 0) - (b.position ?? 0));

    const voice = channels
      .filter((c: Channel) => c.type === ChannelType.VOICE)
      .sort((a: Channel, b: Channel) => (a.position ?? 0) - (b.position ?? 0));

    return { textChannels: text, voiceChannels: voice };
  }, [channels]);

  if (isLoading) return <LoadingSkeleton />;

  if (error) {
    return (
      <Box sx={{ px: 2, py: 2 }}>
        <Typography color="error" variant="body2">
          Failed to load channels.
        </Typography>
      </Box>
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
    <Box sx={{ width: "100%" }}>
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
