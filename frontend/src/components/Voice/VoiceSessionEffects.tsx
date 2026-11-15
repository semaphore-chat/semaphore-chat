import React from "react";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { useLocalMediaState } from "../../hooks/useLocalMediaState";
import { useDeafenEffect } from "../../hooks/useDeafenEffect";
import { usePushToTalk } from "../../hooks/usePushToTalk";
import { useVoicePublishPermissions } from "../../hooks/useVoicePublishPermissions";
import { useWakeLock } from "../../hooks/useWakeLock";
import { useVoicePresenceHeartbeat } from "../../hooks/useVoicePresenceHeartbeat";
import { useBackgroundVoiceKeepAlive } from "../../hooks/useBackgroundVoiceKeepAlive";
import { useVoiceMediaSession } from "../../hooks/useVoiceMediaSession";
import { useServerMuteEffect } from "../../hooks/useServerMuteEffect";
import { useRemoteVolumeEffect } from "../../hooks/useRemoteVolumeEffect";

/**
 * What a call does while it is active, whatever is on screen. It renders
 * nothing.
 *
 * These hooks used to live in VoiceBottomBarContent, so they stopped whenever
 * the bar unmounted (a layout change at a breakpoint, or a screen without the
 * bar). `VoiceSessionLayer` mounts this once, above every layout, while a call
 * is active: the same condition the bar's content mounts on.
 *
 * Loaded lazily (default export): several of these hooks import runtime
 * values from livekit-client, which must stay out of the eager bundle (PR-11,
 * scripts/check-bundle-budget.mjs).
 */
const VoiceSessionEffects: React.FC = () => {
  const { state, actions } = useVoiceConnection();
  const { isMicrophoneEnabled } = useLocalMediaState();
  const publish = useVoicePublishPermissions();

  // The one push-to-talk engine (key listeners, mode switches); the UI reads
  // it through usePushToTalkStatus().
  usePushToTalk({ canSpeak: publish.canSpeak });

  // Prevent tab freeze / OS suspension while in voice
  useBackgroundVoiceKeepAlive({ isConnected: state.isConnected });

  // Keep the screen awake while connected (touch devices / web); no-op in
  // Electron and where the Wake Lock API is unsupported.
  useWakeLock(state.isConnected);

  // Surface the call via the Media Session API (Android ongoing-call
  // notification + higher background process priority, see #350)
  useVoiceMediaSession({
    isConnected: state.isConnected,
    contextName: state.channelName ?? state.dmGroupName,
    isMicrophoneEnabled,
    onHangup: actions.leaveVoiceChannel,
    onToggleMic: actions.toggleMute,
  });

  // Keep voice presence TTL alive in Redis while connected
  useVoicePresenceHeartbeat({
    channelId: state.currentChannelId,
    dmGroupId: state.currentDmGroupId,
    contextType: state.contextType,
    room: state.room,
  });

  // Implement proper deafen functionality (mute received audio)
  useDeafenEffect();

  // Listen for server mute WS events and enforce on local user
  useServerMuteEffect();

  // Reapply per-user volume from localStorage when remote tracks change
  useRemoteVolumeEffect();

  return null;
};

export default VoiceSessionEffects;
