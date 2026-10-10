import { useCallback } from "react";
import { useVoice, useVoiceDispatch, VoiceSessionType, VoiceActionType, type VoiceEndReason } from "../contexts/VoiceContext";
import { useRoom } from "./useRoom";
import { useQuery } from "@tanstack/react-query";
import { livekitControllerGetConnectionInfoOptions } from "../api-client/@tanstack/react-query.gen";
import { useCurrentUser } from "./useCurrentUser";
import { logger } from "../utils/logger";
import {
  joinVoiceChannel,
  leaveVoiceChannel,
  joinDmVoice,
  leaveDmVoice,
  endVoiceSession,
  discardRoomForRejoin,
  beginJoin,
  endJoin,
  toggleMicrophone,
  toggleCameraUnified,
  toggleScreenShareUnified,
  toggleDeafenUnified,
  switchAudioInputDevice,
  switchAudioOutputDevice,
  switchVideoInputDevice,
  playSoundboard,
} from "../features/voice/voiceActions";
import { useTrackSubscriptionActions } from "./useTrackSubscription";

type LivekitConnectionInfo = {
  url: string;
  [key: string]: unknown;
};

function hasLivekitUrl(value: unknown): value is LivekitConnectionInfo {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { url?: unknown };
  return typeof candidate.url === "string" && candidate.url.length > 0;
}

/**
 * Options for a join. `quiet` is an automatic rejoin of the current call
 * after the connection dropped (useVoiceForegroundResync): the dead room is
 * dropped without a hang-up (no REST leave, no sounds, the bar stays up) and
 * the join plays no connect sound.
 */
export interface VoiceJoinOptions {
  startMuted?: boolean;
  quiet?: boolean;
}

type VoiceDeps = Parameters<typeof leaveVoiceChannel>[0];

/**
 * Before a join: hang up the current call, or, for a quiet rejoin, only drop
 * the dead room. The caller holds the join slot, so the hang-up must not
 * cancel it.
 */
async function leaveCurrentBeforeJoin(deps: VoiceDeps, quiet: boolean) {
  const currentState = deps.getVoiceState();
  if (quiet) {
    await discardRoomForRejoin(deps);
    return;
  }
  if (currentState.isConnected) {
    logger.info('[useVoiceConnection] Already connected, leaving the current call first');
    if (currentState.contextType === VoiceSessionType.Dm) {
      await leaveDmVoice(deps, { keepPendingJoin: true });
    } else {
      await leaveVoiceChannel(deps, { keepPendingJoin: true });
    }
  }
}

export const useVoiceConnection = () => {
  const voiceState = useVoice();
  const { dispatch, stateRef } = useVoiceDispatch();
  const { room, setRoom, getRoom } = useRoom();
  const { user } = useCurrentUser();
  const { data: connectionInfo } = useQuery(livekitControllerGetConnectionInfoOptions());

  const getDeps = useCallback(() => ({
    dispatch,
    getVoiceState: () => stateRef.current,
    getRoom,
    setRoom,
  }), [dispatch, stateRef, getRoom, setRoom]);

  const handleJoinVoiceChannel = useCallback(
    async (
      channelId: string,
      channelName: string,
      communityId: string,
      isPrivate: boolean,
      createdAt: string,
      options: VoiceJoinOptions = {},
    ) => {
      logger.info('[useVoiceConnection] handleJoinVoiceChannel called');
      logger.info('[useVoiceConnection] user:', user?.id, 'connectionInfo:', !!connectionInfo);

      if (!user || !connectionInfo) {
        logger.error('[useVoiceConnection] Missing user or connectionInfo');
        throw new Error("User or connection info not available");
      }
      if (!hasLivekitUrl(connectionInfo)) {
        logger.error('[useVoiceConnection] Missing LiveKit URL in connection info payload');
        throw new Error("LiveKit URL is missing. Check backend LIVEKIT_URL configuration.");
      }
      const livekitConnectionInfo = connectionInfo;

      // One join at a time: claim the slot before leaving the current call,
      // so a double-click can't start a second join meanwhile.
      const join = beginJoin({ kind: options.quiet ? 'rejoin' : 'user', channelId });
      if (!join) return;
      try {
        const deps = getDeps();
        await leaveCurrentBeforeJoin(deps, options.quiet === true);
        if (join.cancelled) return;

        logger.info('[useVoiceConnection] Calling joinVoiceChannel...');
        await joinVoiceChannel(
          {
            channelId,
            channelName,
            communityId,
            isPrivate,
            createdAt,
            user: {
              id: user.id,
              username: user.username,
              displayName: user.displayName ?? undefined,
            },
            // Forward the full backend payload so future connection fields are preserved.
            connectionInfo: livekitConnectionInfo,
            startMuted: options.startMuted,
            quiet: options.quiet,
            claimedJoin: join,
          },
          deps
        );
        logger.info('[useVoiceConnection] joinVoiceChannel completed');
      } finally {
        endJoin(join);
      }
    },
    [user, connectionInfo, getDeps]
  );

  const handleJoinDmVoice = useCallback(
    async (dmGroupId: string, dmGroupName: string, options: VoiceJoinOptions = {}) => {
      if (!user || !connectionInfo) {
        throw new Error("User or connection info not available");
      }
      if (!hasLivekitUrl(connectionInfo)) {
        throw new Error("LiveKit URL is missing. Check backend LIVEKIT_URL configuration.");
      }
      const livekitConnectionInfo = connectionInfo;

      const join = beginJoin({ kind: options.quiet ? 'rejoin' : 'user', dmGroupId });
      if (!join) return;
      try {
        const deps = getDeps();
        await leaveCurrentBeforeJoin(deps, options.quiet === true);
        if (join.cancelled) return;

        await joinDmVoice(
          {
            dmGroupId,
            dmGroupName,
            user: {
              id: user.id,
              username: user.username,
              displayName: user.displayName ?? undefined,
            },
            // Forward the full backend payload so future connection fields are preserved.
            connectionInfo: livekitConnectionInfo,
            startMuted: options.startMuted,
            quiet: options.quiet,
            claimedJoin: join,
          },
          deps
        );
      } finally {
        endJoin(join);
      }
    },
    [user, connectionInfo, getDeps]
  );

  const handleLeaveVoiceChannel = useCallback(async () => {
    const deps = getDeps();
    if (deps.getVoiceState().contextType === VoiceSessionType.Dm) {
      await leaveDmVoice(deps);
    } else {
      await leaveVoiceChannel(deps);
    }
  }, [getDeps]);

  const handleEndVoiceSession = useCallback(
    async (reason: VoiceEndReason, error: string | null = null) => {
      await endVoiceSession(reason, getDeps(), error);
    },
    [getDeps]
  );

  const handleToggleAudio = useCallback(async () => {
    await toggleMicrophone(getDeps());
  }, [getDeps]);

  const handleToggleVideo = useCallback(async () => {
    await toggleCameraUnified(getDeps());
  }, [getDeps]);

  const handleToggleScreenShare = useCallback(async () => {
    await toggleScreenShareUnified(getDeps());
  }, [getDeps]);

  const handleToggleMute = useCallback(async () => {
    await toggleMicrophone(getDeps());
  }, [getDeps]);

  const handleToggleDeafen = useCallback(async () => {
    await toggleDeafenUnified(getDeps());
  }, [getDeps]);

  const handleSetShowVideoTiles = useCallback(
    (show: boolean) => {
      dispatch({ type: VoiceActionType.SetShowVideoTiles, payload: show });
    },
    [dispatch]
  );

  const handleSetPipCollapsed = useCallback(
    (collapsed: boolean) => {
      dispatch({ type: VoiceActionType.SetPipCollapsed, payload: collapsed });
    },
    [dispatch]
  );

  // Reveal the video panel expanded — used by every "show video tiles"
  // call site so a screen-share auto-show (or any other reveal) can't leave
  // the user looking at a pill instead of the panel they expected to see.
  const handleRevealVideoTiles = useCallback(() => {
    dispatch({ type: VoiceActionType.SetShowVideoTiles, payload: true });
    dispatch({ type: VoiceActionType.SetPipCollapsed, payload: false });
  }, [dispatch]);

  const handleSwitchAudioInputDevice = useCallback(
    async (deviceId: string) => {
      await switchAudioInputDevice(deviceId, getDeps());
    },
    [getDeps]
  );

  const handleSwitchAudioOutputDevice = useCallback(
    async (deviceId: string) => {
      await switchAudioOutputDevice(deviceId, getDeps());
    },
    [getDeps]
  );

  const handleSwitchVideoInputDevice = useCallback(
    async (deviceId: string) => {
      await switchVideoInputDevice(deviceId, getDeps());
    },
    [getDeps]
  );

  const handlePlaySoundboard = useCallback(
    async (fileId: string) => {
      await playSoundboard(fileId, getDeps());
    },
    [getDeps]
  );

  const trackActions = useTrackSubscriptionActions();

  return {
    state: { ...voiceState, room },
    actions: {
      joinVoiceChannel: handleJoinVoiceChannel,
      joinDmVoice: handleJoinDmVoice,
      leaveVoiceChannel: handleLeaveVoiceChannel,
      // Cancelling an automatic rejoin hangs up (it cancels the loop too).
      cancelReconnect: handleLeaveVoiceChannel,
      endVoiceSession: handleEndVoiceSession,
      /** The current room, read synchronously (not from render state). */
      getRoom,
      toggleAudio: handleToggleAudio,
      toggleVideo: handleToggleVideo,
      toggleScreenShare: handleToggleScreenShare,
      toggleMute: handleToggleMute,
      toggleDeafen: handleToggleDeafen,
      setShowVideoTiles: handleSetShowVideoTiles,
      setPipCollapsed: handleSetPipCollapsed,
      revealVideoTiles: handleRevealVideoTiles,
      switchAudioInputDevice: handleSwitchAudioInputDevice,
      switchAudioOutputDevice: handleSwitchAudioOutputDevice,
      switchVideoInputDevice: handleSwitchVideoInputDevice,
      playSoundboard: handlePlaySoundboard,
      watchCamera: trackActions?.watchCamera ?? undefined,
      stopWatchingCamera: trackActions?.stopWatchingCamera ?? undefined,
      watchScreenShare: trackActions?.watchScreenShare ?? undefined,
      stopWatchingScreenShare: trackActions?.stopWatchingScreenShare ?? undefined,
    },
  };
};
