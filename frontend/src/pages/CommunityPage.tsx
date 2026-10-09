import React, { useEffect } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  communityControllerFindOneOptions,
  channelsControllerFindOneOptions,
  channelsControllerFindAllForCommunityOptions,
} from "../api-client/@tanstack/react-query.gen";
import { Avatar, Box, Typography } from "@mui/material";
import ChannelList from "../components/Channel/ChannelList";
import ChannelMessageContainer from "../components/Channel/ChannelMessageContainer";
import { VideoTiles } from "../components/Voice";
import { VoiceChannelPreJoin } from "../components/Voice/VoiceChannelPreJoin";
import EditCommunityButton from "../components/Community/EditCommunityButton";
import TwoColumnLayout from "../components/Common/TwoColumnLayout";
import { styled } from "@mui/material/styles";
import { ChannelType } from "../types/channel.type";
import { useVoiceConnection } from "../hooks/useVoiceConnection";
import { useAuthenticatedImage } from "../hooks/useAuthenticatedImage";
import { useResponsive } from "../hooks/useResponsive";
import { useStagePresence } from "../hooks/useStagePresence";
import { useCurrentUser } from "../hooks/useCurrentUser";
import PageError from "../components/Common/PageError";
import { COMMUNITY_ERROR_COPY } from "../utils/pageError";
import { getLastChannelId, pickInitialChannel, setLastChannelId } from "../utils/lastChannel";

const CommunityPage: React.FC = () => {
  const { isMobile } = useResponsive();

  // Mobile version is handled by MobileLayout with panel navigation
  if (isMobile) {
    return null;
  }

  // Desktop version below
  return <DesktopCommunityPage />;
};

const DesktopCommunityPage: React.FC = () => {
  const { communityId, channelId } = useParams<{
    communityId: string;
    channelId: string;
  }>();
  const { user } = useCurrentUser();
  const { data, error, isLoading, refetch } = useQuery({
    ...communityControllerFindOneOptions({ path: { id: communityId! } }),
    enabled: !!communityId,
  });
  const { data: channelData } = useQuery({
    ...channelsControllerFindOneOptions({ path: { id: channelId! } }),
    enabled: !!channelId,
  });
  // Opening a community with no channel selected: go to the last-visited text
  // channel (or the first visible one) rather than an empty placeholder. The
  // list is the one ChannelList reads, so it is shared through the cache.
  const { data: channelList, isSuccess: channelListLoaded } = useQuery({
    ...channelsControllerFindAllForCommunityOptions({ path: { communityId: communityId! } }),
    enabled: !!communityId && !channelId,
  });
  const { state: voiceState } = useVoiceConnection();

  // Remember the text channel being viewed, per user and community.
  const viewedTextChannelId =
    channelData?.type === ChannelType.TEXT && channelData.id === channelId ? channelData.id : undefined;
  useEffect(() => {
    if (communityId && viewedTextChannelId) setLastChannelId(user?.id, communityId, viewedTextChannelId);
  }, [user?.id, communityId, viewedTextChannelId]);
  const { blobUrl: communityAvatarUrl } = useAuthenticatedImage(data?.avatar);

  const isConnectedToVoiceChannel = Boolean(
    channelData?.type === ChannelType.VOICE &&
    voiceState.isConnected &&
    voiceState.currentChannelId === channelId
  );
  useStagePresence(isConnectedToVoiceChannel);

  if (!communityId) return <div>Community ID is required</div>;
  if (isLoading) return <div>Loading...</div>;
  if (error) {
    return <PageError error={error} copy={COMMUNITY_ERROR_COPY} onRetry={() => void refetch()} />;
  }
  if (!data) return <div>No community data found</div>;

  const initialChannel = !channelId && channelListLoaded && user
    ? pickInitialChannel(channelList, getLastChannelId(user.id, communityId))
    : null;
  if (initialChannel) {
    return <Navigate to={`/community/${communityId}/channel/${initialChannel.id}`} replace />;
  }

  const renderChannelContent = () => {
    if (!channelId) {
      return (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <Typography variant="h5" color="text.secondary">
            Welcome to {data.name}
          </Typography>
          <Typography variant="body1" color="text.secondary" textAlign="center">
            Select a channel from the sidebar to get started
          </Typography>
        </Box>
      );
    }

    if (channelData?.type === ChannelType.VOICE) {
      if (isConnectedToVoiceChannel) {
        return (
          <Box sx={{ height: '100%', width: '100%', minHeight: 0, display: 'flex' }}>
            <VideoTiles />
          </Box>
        );
      }

      return <VoiceChannelPreJoin channel={channelData} />;
    }

    if (voiceState.isConnected && channelData?.type === ChannelType.TEXT) {
      return <ChannelMessageContainer channelId={channelId} />;
    }

    return <ChannelMessageContainer channelId={channelId} />;
  };

  return (
    <TwoColumnLayout
      sidebar={
        <>
          <CommunityHeader>
            <CommunityInfo>
              <Avatar
                src={communityAvatarUrl || undefined}
                alt={`${data.name} logo`}
                sx={{ width: 40, height: 40 }}
              >
                {data.name.charAt(0).toUpperCase()}
              </Avatar>
              <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
                {data.name}
              </Typography>
            </CommunityInfo>
            <EditCommunityButton communityId={communityId} />
          </CommunityHeader>
          <ChannelList communityId={communityId} />
        </>
      }
      contentSx={
        isConnectedToVoiceChannel
          ? undefined
          : {
              flexDirection: "column-reverse",
              alignItems: "center",
            }
      }
    >
      {renderChannelContent()}
    </TwoColumnLayout>
  );
};

const CommunityHeader = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: theme.spacing(1.5),
  padding: theme.spacing(0, 2, 2, 2),
  borderBottom: `1px solid ${theme.palette.divider}`,
}));

const CommunityInfo = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  gap: theme.spacing(1.5),
  flex: 1,
  minWidth: 0, // Allow text to truncate
}));

export default CommunityPage;
