/**
 * The call bar as both shells show it: where the call is, its phase, the mic
 * (tap to mute, push-to-talk key, touch hold-to-talk, blocked, server-muted),
 * deafen, screen share, who is talking, and the actions. The classic
 * `VoiceBottomBarContent` renders its labels from this model, so the two bars
 * cannot drift (design §5).
 *
 * No hook here changes the call by itself: the call's behaviour runs in
 * `VoiceSessionEffects`. The model only reads state and hands out actions.
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { VoiceSessionType } from '../contexts/VoiceContext';
import { useVoiceConnection } from '../hooks/useVoiceConnection';
import { useLocalMediaState } from '../hooks/useLocalMediaState';
import { usePushToTalkStatus } from '../hooks/usePushToTalk';
import { useVoicePublishPermissions } from '../hooks/useVoicePublishPermissions';
import { useSpeaking } from '../hooks/useSpeaking';
import { useCurrentUser } from '../hooks/useCurrentUser';

export type CallPhase = 'connecting' | 'connected' | 'reconnecting';

export type CallPlace =
  | { kind: 'channel'; name: string; channelId: string; communityId: string | null }
  | { kind: 'dm'; name: string; dmGroupId: string };

export type MicMode = 'toggle' | 'pushToTalkKey' | 'holdToTalk';

export interface CallBarMic {
  /** The microphone is publishing. */
  on: boolean;
  /** The control's accessible name: "Mute", or "Hold to talk" for touch hold-to-talk. */
  label: string;
  /** The tooltip: what the control does now, or why it can't. */
  title: string;
  /** Extra context for assistive tech (a block, push-to-talk, server mute); null when the name says it all. */
  description: string | null;
  /** No SPEAK permission (or a timeout) and the mic is off: turning it on is not allowed. */
  blocked: boolean;
  serverMuted: boolean;
  mode: MicMode;
  /** Tapping toggles the mic (off under push-to-talk and server mute). */
  tappable: boolean;
  /** The push-to-talk key's name ("V"); null unless push-to-talk is on. */
  keyLabel: string | null;
  /** The push-to-talk key (or a touch hold) is held. */
  transmitting: boolean;
  /** You are speaking with the mic on. */
  speaking: boolean;
}

export interface CallBarActions {
  toggleMute(): void;
  toggleDeafen(): void;
  leave(): void;
  /** Cancel an automatic reconnect (hangs up). */
  cancel(): void;
  /** Stop your screen share (no-op when not sharing). Starting one needs the picker: classic only. */
  stopSharing(): void;
  /** Go to the classic call view and show the video tiles. */
  openCallView(): void;
  /** Touch hold-to-talk: start transmitting. False when nothing started (server-muted). */
  holdStart(): boolean;
  /** Touch hold-to-talk: stop. False when no hold was running (idempotent across pointer events). */
  holdEnd(): boolean;
}

export interface CallBarModel {
  place: CallPlace;
  phase: CallPhase;
  /** 1-based attempt while reconnecting, else null. */
  reconnectAttempt: number | null;
  /** The line under the name: "Voice Connected" / "DM Voice Call" (phase aside). */
  kindLabel: string;
  mic: CallBarMic;
  deafened: boolean;
  sharingScreen: boolean;
  /** Who else is talking ("dropbear"), first speaker only; null when nobody is. */
  talking: string | null;
  actions: CallBarActions;
  /** The classic voice room or DM route. */
  callViewPath: string;
}

/**
 * @param touch the layout is touch-first: push-to-talk becomes hold-to-talk on the mic button.
 * @returns null when not in a call (or joining one).
 */
export function useCallBarModel(touch: boolean): CallBarModel | null {
  const navigate = useNavigate();
  const { state, actions } = useVoiceConnection();
  const { isMicrophoneEnabled, isScreenShareEnabled } = useLocalMediaState();
  const publish = useVoicePublishPermissions();
  const { isSpeaking, speakingMap } = useSpeaking();
  const { user: currentUser } = useCurrentUser();
  const { isActive: isPTTActive, isKeyHeld, currentKeyDisplay, pttPress, pttRelease } = usePushToTalkStatus();

  // Hold-to-talk: one engaged hold at a time; the release path is idempotent
  // across pointerup / pointercancel / lostpointercapture.
  const holdEngagedRef = useRef(false);
  const serverMuted = state.isServerMuted;
  const holdStart = useCallback(() => {
    if (serverMuted) return false;
    holdEngagedRef.current = true;
    void pttPress?.();
    return true;
  }, [serverMuted, pttPress]);
  const holdEnd = useCallback(() => {
    if (!holdEngagedRef.current) return false;
    holdEngagedRef.current = false;
    void pttRelease?.();
    return true;
  }, [pttRelease]);

  // In a call = in a channel or a DM; the context type picks which (as the classic bar always did).
  const place = useMemo<CallPlace | null>(() => {
    if (!state.currentChannelId && !state.currentDmGroupId) return null;
    if (state.contextType === VoiceSessionType.Dm) {
      return { kind: 'dm', name: state.dmGroupName || 'Direct Message', dmGroupId: state.currentDmGroupId ?? '' };
    }
    return {
      kind: 'channel',
      name: state.channelName || 'Voice Channel',
      channelId: state.currentChannelId ?? '',
      communityId: state.communityId,
    };
  }, [state.contextType, state.currentChannelId, state.currentDmGroupId, state.channelName, state.dmGroupName, state.communityId]);

  const callViewPath = !place
    ? '/'
    : place.kind === 'dm'
      ? `/direct-messages/${place.dmGroupId}`
      : `/community/${place.communityId}/channel/${place.channelId}`;

  const { revealVideoTiles, toggleScreenShare } = actions;
  const openCallView = useCallback(() => {
    navigate(callViewPath);
    revealVideoTiles();
  }, [navigate, callViewPath, revealVideoTiles]);
  const stopSharing = useCallback(() => {
    if (isScreenShareEnabled) void toggleScreenShare();
  }, [isScreenShareEnabled, toggleScreenShare]);

  const room = state.room;
  const talking = useMemo(() => {
    for (const [id, speaking] of speakingMap) {
      if (!speaking || id === currentUser?.id) continue;
      const participant = room?.remoteParticipants?.get(id);
      return participant?.name || participant?.identity || null;
    }
    return null;
  }, [speakingMap, currentUser?.id, room]);

  if (!(state.isConnected || state.isConnecting) || !place) return null;

  const blocked = !publish.canSpeak && !isMicrophoneEnabled;
  const holdToTalk = isPTTActive && touch;
  const title = blocked
    ? publish.speakBlockedReason
    : serverMuted
      ? 'Server Muted — contact a moderator'
      : holdToTalk
        ? isKeyHeld ? 'Transmitting...' : 'Hold to talk'
        : isPTTActive
          ? isKeyHeld ? 'Transmitting...' : `Hold ${currentKeyDisplay} to talk`
          : !isMicrophoneEnabled ? 'Unmute' : 'Mute';
  // Names stay fixed ("Mute") with aria-pressed carrying the state; hold-to-talk isn't a toggle.
  const label = holdToTalk && !blocked ? 'Hold to talk' : 'Mute';
  const description = title === 'Mute' || title === 'Unmute' || title === label ? null : title;
  const youAreSpeaking = currentUser ? isSpeaking(currentUser.id) : false;

  return {
    place,
    phase: state.reconnect ? 'reconnecting' : state.isConnected ? 'connected' : 'connecting',
    reconnectAttempt: state.reconnect?.attempt ?? null,
    kindLabel: place.kind === 'dm' ? 'DM Voice Call' : 'Voice Connected',
    mic: {
      on: isMicrophoneEnabled,
      label,
      title,
      description,
      blocked,
      serverMuted,
      mode: holdToTalk ? 'holdToTalk' : isPTTActive ? 'pushToTalkKey' : 'toggle',
      tappable: !isPTTActive && !serverMuted,
      keyLabel: isPTTActive ? currentKeyDisplay : null,
      transmitting: isKeyHeld,
      speaking: isMicrophoneEnabled && youAreSpeaking,
    },
    deafened: state.isDeafened,
    sharingScreen: isScreenShareEnabled,
    talking,
    actions: {
      toggleMute: actions.toggleMute,
      toggleDeafen: actions.toggleDeafen,
      leave: actions.leaveVoiceChannel,
      cancel: actions.cancelReconnect,
      stopSharing,
      openCallView,
      holdStart,
      holdEnd,
    },
    callViewPath,
  };
}
