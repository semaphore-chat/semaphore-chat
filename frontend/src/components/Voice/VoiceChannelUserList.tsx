import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Typography,
  Chip,
  Paper,
  List,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useQuery } from "@tanstack/react-query";
import { voicePresenceControllerGetChannelPresenceOptions } from "../../api-client/@tanstack/react-query.gen";
import type { VoicePresenceUserDto } from "../../api-client/types.gen";
import { ChannelType, type Channel } from "../../types/channel.type";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { useUserProfile } from "../../contexts/UserProfileContext";
import VoiceUserContextMenu from "./VoiceUserContextMenu";
import { ROOM_EVENT } from "../../features/voice/livekitEvents";
import { getUserInfo } from "../../features/users/userApiHelpers";
import { useServerEvent } from "../../socket-hub/useServerEvent";
import { ServerEvents } from "@semaphore-chat/shared";
import { useSpeaking } from "../../hooks/useSpeaking";
import { useVoice } from "../../contexts/VoiceContext";
import { useTrackSubscriptionActions } from "../../hooks/useTrackSubscription";
import { useContextMenuFocusRestore } from "../../hooks/useContextMenuFocusRestore";
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
  const { state: voiceState, actions: voiceActions } = useVoiceConnection();
  const { isSpeaking } = useSpeaking();
  const { watchingCameras, watchingScreenShares } = useVoice();
  const trackActions = useTrackSubscriptionActions();
  const [livekitParticipants, setLivekitParticipants] = useState<VoicePresenceUserDto[]>([]);
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

  // Check if we're connected to this specific channel
  const isConnectedToThisChannel = voiceState.currentChannelId === channel.id && voiceState.isConnected;

  // Use backend presence query only when NOT connected to this channel
  // (for viewing other voice channels we're not in)
  const {
    data: backendPresence,
    isLoading: backendLoading,
    error: backendError,
  } = useQuery({
    ...voicePresenceControllerGetChannelPresenceOptions({ path: { channelId: channel.id } }),
    enabled: channel.type === ChannelType.VOICE && !isConnectedToThisChannel,
    refetchInterval: 120_000,
  });

  // When connected to this channel, get participants directly from LiveKit
  useEffect(() => {
    if (!isConnectedToThisChannel || !voiceState.room) {
      setLivekitParticipants([]);
      return;
    }

    const room = voiceState.room;
    let updateVersion = 0;

    const updateParticipants = async () => {
      const version = ++updateVersion;

      // Collect all participants and their metadata synchronously
      const allParticipants: { identity: string; name: string | undefined; isDeafened: boolean }[] = [];

      const local = room.localParticipant;
      if (local && local.identity) {
        let localMeta: { isDeafened?: boolean } = {};
        try { if (local.metadata) localMeta = JSON.parse(local.metadata); } catch { /* ignore */ }
        allParticipants.push({
          identity: local.identity,
          name: local.name || undefined,
          isDeafened: localMeta.isDeafened ?? false,
        });
      }

      room.remoteParticipants.forEach((participant) => {
        let metadata: { isDeafened?: boolean } = {};
        try { if (participant.metadata) metadata = JSON.parse(participant.metadata); } catch { /* ignore */ }
        allParticipants.push({
          identity: participant.identity,
          name: participant.name || undefined,
          isDeafened: metadata.isDeafened ?? false,
        });
      });

      // Fetch all user info in parallel
      const userInfos = await Promise.all(
        allParticipants.map((p) => getUserInfo(p.identity))
      );

      // Discard stale updates if a newer one was started
      if (version !== updateVersion) return;

      const participants: VoicePresenceUserDto[] = allParticipants.map((p, i) => ({
        id: p.identity,
        username: p.name || p.identity,
        displayName: p.name || undefined,
        avatarUrl: userInfos[i]?.avatarUrl ?? undefined,
        // Not shown anywhere (the list no longer has "Joined X ago"); the DTO requires it
        joinedAt: new Date().toISOString(),
        isDeafened: p.isDeafened,
        // LiveKit participant metadata doesn't carry server-mute state; the
        // REST presence path is the source of truth for it
        isServerMuted: false,
      }));

      setLivekitParticipants(participants);
    };

    // Debounce rapid event bursts (e.g. multiple participants joining at once)
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => updateParticipants(), 100);
    };

    // Initial update (immediate)
    updateParticipants();

    // Listen for participant changes (debounced)
    const events = [
      ROOM_EVENT.ParticipantConnected,
      ROOM_EVENT.ParticipantDisconnected,
      ROOM_EVENT.Connected,
      ROOM_EVENT.ParticipantMetadataChanged,
    ] as const;

    events.forEach((event) => room.on(event, debouncedUpdate));

    return () => {
      updateVersion++; // Invalidate any in-flight async updates
      if (debounceTimer) clearTimeout(debounceTimer);
      events.forEach((event) => room.off(event, debouncedUpdate));
    };
  }, [isConnectedToThisChannel, voiceState.room]);

  // Update isServerMuted for livekitParticipants from WS events
  // (LiveKit metadata doesn't carry server mute state — it comes from backend via WS)
  useServerEvent(ServerEvents.VOICE_CHANNEL_USER_UPDATED, (payload) => {
    if (!isConnectedToThisChannel || payload.channelId !== channel.id) return;
    setLivekitParticipants((prev) =>
      prev.map((p) =>
        p.id === payload.userId
          ? { ...p, isServerMuted: payload.user.isServerMuted ?? false }
          : p,
      ),
    );
  });

  // Determine which data source to use
  const presence = isConnectedToThisChannel
    ? { channelId: channel.id, users: livekitParticipants, count: livekitParticipants.length }
    : backendPresence;
  const isLoading = !isConnectedToThisChannel && backendLoading;
  const error = !isConnectedToThisChannel && backendError;

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
              localParticipantIdentity={voiceState.room?.localParticipant?.identity}
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
