import React, { useState, useRef } from "react";
import {
  Box,
  Typography,
  Chip,
  Paper,
  List,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { VoicePresenceUserDto } from "../../api-client/types.gen";
import { ChannelType, type Channel } from "../../types/channel.type";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { useUserProfile } from "../../contexts/UserProfileContext";
import VoiceUserContextMenu from "./VoiceUserContextMenu";
import { useSpeaking } from "../../hooks/useSpeaking";
import { useVoice } from "../../contexts/VoiceContext";
import { useTrackSubscriptionActions } from "../../hooks/useTrackSubscription";
import { useContextMenuFocusRestore } from "../../hooks/useContextMenuFocusRestore";
import { useVoiceRoomPeople } from "../../data/voiceRoom";
import CompactUserItem from "./components/CompactUserItem";
import UserItem from "./components/UserItem";
import InlineUserAvatar from "./components/InlineUserAvatar";

interface VoiceChannelUserListProps {
  channel: Channel;
  showInline?: boolean;
  showCompact?: boolean;
  /**
   * Grow to the parent's available height (the parent must be a flex column)
   * instead of the default 300px cap — used by the phone pre-join screen.
   */
  fill?: boolean;
}

export const VoiceChannelUserList: React.FC<VoiceChannelUserListProps> = ({
  channel,
  showInline = false,
  showCompact = false,
  fill = false,
}) => {
  const theme = useTheme();
  const { actions: voiceActions } = useVoiceConnection();
  const { isSpeaking } = useSpeaking();
  const { watchingCameras, watchingScreenShares } = useVoice();
  const trackActions = useTrackSubscriptionActions();
  const { openProfile } = useUserProfile();
  const [contextMenu, setContextMenu] = useState<{
    position: { top: number; left: number } | null;
    user: VoicePresenceUserDto | null;
  }>({ position: null, user: null });

  const { captureTrigger, restoreFocus } = useContextMenuFocusRestore();
  // Fallback restore target: this list is presence-driven, so the row that
  // opened the menu can unmount while the menu is closing (e.g. the
  // participant disconnects). The list/row container outlives any
  // individual row, so it's a safe place to land focus in that case.
  const listContainerRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = (event: React.MouseEvent<HTMLElement>, user: VoicePresenceUserDto) => {
    event.preventDefault();
    captureTrigger(event.currentTarget);
    setContextMenu({ position: { top: event.clientY, left: event.clientX }, user });
  };

  const handleCloseContextMenu = () => {
    setContextMenu({ position: null, user: null });
    // anchorPosition menus have no anchor element for MUI to auto-restore
    // focus to on close — return it to the user row that opened this,
    // falling back to the list container if that row unmounted while the
    // menu was closing (e.g. the participant disconnected).
    restoreFocus(listContainerRef.current);
  };

  // Who is here: LiveKit when we're in this room, the server's presence otherwise
  const room = useVoiceRoomPeople(channel);
  const isConnectedToThisChannel = room.youAreHere;
  const presence = isConnectedToThisChannel || room.status === "success"
    ? { users: room.users, count: room.count }
    : undefined;
  const isLoading = room.isLoading;
  const error = room.error;

  if (channel.type !== ChannelType.VOICE) {
    return null;
  }

  if (isLoading) {
    return (
      <Box sx={{ p: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Loading voice channel...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 1 }}>
        <Typography variant="body2" color="error">
          Failed to load voice channel users
        </Typography>
      </Box>
    );
  }

  if (!presence || presence.users.length === 0) {
    return null;
  }

  const contextMenuElement = contextMenu.user && (
    <VoiceUserContextMenu
      anchorPosition={contextMenu.position}
      open={Boolean(contextMenu.position)}
      onClose={handleCloseContextMenu}
      user={contextMenu.user}
      communityId={channel.communityId}
      onViewProfile={() => openProfile(contextMenu.user!.id)}
    />
  );

  if (showInline) {
    return (
      <>
        <Box
          ref={listContainerRef}
          tabIndex={-1}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            flexWrap: "wrap",
          }}
        >
          {presence.users.slice(0, 3).map((user) => (
            <InlineUserAvatar
              key={user.id}
              user={user}
              onContextMenu={handleContextMenu}
              onClickUser={openProfile}
            />
          ))}
          {presence.users.length > 3 && (
            <Chip
              label={`+${presence.users.length - 3}`}
              size="small"
              sx={{ height: 24, fontSize: 'scale.sm' }}
            />
          )}
        </Box>
        {contextMenuElement}
      </>
    );
  }

  if (showCompact) {
    return (
      <>
        <Box ref={listContainerRef} tabIndex={-1}>
          {presence.users.map((user) => (
            <CompactUserItem
              key={user.id}
              user={user}
              isConnectedToThisChannel={isConnectedToThisChannel}
              localParticipantIdentity={room.localIdentity}
              isSpeaking={isSpeaking}
              onContextMenu={handleContextMenu}
              onClickUser={openProfile}
              onShowVideoTiles={() => voiceActions.revealVideoTiles()}
              isWatchingCamera={watchingCameras.has(user.id)}
              isWatchingScreenShare={watchingScreenShares.has(user.id)}
              onWatchCamera={trackActions?.watchCamera}
              onStopWatchingCamera={trackActions?.stopWatchingCamera}
              onWatchScreenShare={trackActions?.watchScreenShare}
              onStopWatchingScreenShare={trackActions?.stopWatchingScreenShare}
            />
          ))}
        </Box>
        {contextMenuElement}
      </>
    );
  }

  return (
    <>
      <Paper
        ref={listContainerRef}
        tabIndex={-1}
        elevation={2}
        sx={{
          maxHeight: fill ? "none" : 300,
          ...(fill && { flex: "0 1 auto", minHeight: 0 }),
          overflow: "auto",
          "&::-webkit-scrollbar": {
            width: 6,
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: theme.palette.semantic.overlay.heavy,
            borderRadius: 3,
          },
        }}
      >
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="h6" gutterBottom>
            Voice Channel — {presence.count}{" "}
            {presence.count === 1 ? "user" : "users"}
          </Typography>
        </Box>

        <List disablePadding>
          {presence.users.map((user, index) => (
            <UserItem
              key={user.id}
              user={user}
              index={index}
              totalCount={presence.users.length}
              showInline={showInline}
              onContextMenu={handleContextMenu}
              onClickUser={openProfile}
            />
          ))}
        </List>
      </Paper>
      {contextMenuElement}
    </>
  );
};
