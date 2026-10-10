import { createContext, useContext, type Dispatch, type RefObject } from "react";
import { VideoLayoutMode } from "../types/videoLayout";

// Voice session state, actions, contexts and hooks. The provider component
// (reducer + persistence) lives in VoiceProvider.tsx so each module only
// exports components or non-components (React Fast Refresh).

export enum VoiceSessionType {
  Channel = 'channel',
  Dm = 'dm',
}

/**
 * Why a call ended without the user hanging up. Recorded in
 * `VoiceState.lastEnded` so the UI can tell the user (see
 * features/voice/voiceEndReason.ts for the messages).
 */
export enum VoiceEndReason {
  /** The same account joined voice from another device (newest join wins). */
  DuplicateIdentity = 'duplicate_identity',
  /** A moderator removed us, we lost access to the channel, or the session was revoked. */
  ParticipantRemoved = 'participant_removed',
  /** The LiveKit room was deleted (e.g. the channel was deleted). */
  RoomDeleted = 'room_deleted',
  /** The connection dropped and every automatic rejoin attempt failed. */
  ReconnectFailed = 'reconnect_failed',
  /** A rejoin was refused with 403: no access to the channel any more (removed, banned, permissions). */
  AccessLost = 'access_lost',
  /** A rejoin got 404: the channel or DM no longer exists. */
  ChannelNotFound = 'channel_not_found',
  /** A rejoin got 401 after the session refresh: the session is gone (signed out, revoked). */
  SessionExpired = 'session_expired',
}

/** What a voice join was for, so a notice can offer Retry. */
export type VoiceJoinTarget =
  | {
      type: 'channel';
      channelId: string;
      channelName: string;
      communityId: string;
      isPrivate: boolean;
      createdAt: string;
    }
  | { type: 'dm'; dmGroupId: string; dmGroupName: string };

export interface VoiceEnded {
  reason: VoiceEndReason;
  /** The last error message, when there was one (ReconnectFailed). */
  error: string | null;
  /** Epoch ms. */
  at: number;
  /** The call that ended (for Retry), when known. */
  target?: VoiceJoinTarget | null;
}

/**
 * How a failed join is classified for the user (features/voice/joinFailure.ts).
 * The string values are what the client reports to
 * POST /voice/diagnostics/join-failure.
 */
export enum VoiceFailureKind {
  /** Signalling worked but WebRTC media couldn't connect (UDP blocked, no TURN). */
  MediaUnreachable = 'media_unreachable',
  /** The voice server (or the API) couldn't be reached at all. */
  ServerUnreachable = 'server_unreachable',
  Permission = 'permission',
  NotFound = 'not_found',
  Session = 'session',
  ServerError = 'server_error',
  Unknown = 'unknown',
}

/** A join the user started that failed; shown by VoiceNotice until dismissed or retried. */
export interface VoiceJoinFailure {
  kind: VoiceFailureKind;
  /** The raw error message (for details / diagnostics). */
  error: string | null;
  target: VoiceJoinTarget;
  at: number;
}

/**
 * An automatic rejoin in progress after the connection dropped (see
 * useVoiceForegroundResync). The call stays "connected" in the UI meanwhile.
 */
export interface VoiceReconnectState {
  /** 1-based attempt number. */
  attempt: number;
  maxAttempts: number;
  /** Epoch ms of the next attempt; null while waiting for the network or the window to be visible, or while an attempt runs. */
  nextRetryAt: number | null;
}

export interface VoiceState {
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  contextType: VoiceSessionType | null;
  currentChannelId: string | null;
  channelName: string | null;
  communityId: string | null;
  isPrivate: boolean | null;
  createdAt: string | null;
  currentDmGroupId: string | null;
  dmGroupName: string | null;
  isDeafened: boolean;
  showVideoTiles: boolean;
  pipCollapsed: boolean;
  screenShareAudioFailed: boolean;
  selectedAudioInputId: string | null;
  selectedAudioOutputId: string | null;
  selectedVideoInputId: string | null;
  wasMutedBeforeDeafen: boolean;
  isServerMuted: boolean;
  watchingCameras: Set<string>;
  watchingScreenShares: Set<string>;
  hiddenLocalTiles: Set<string>;
  stageMounted: boolean;
  layoutMode: VideoLayoutMode;
  pinnedTileId: string | null;
  spotlightTileId: string | null;
  /** Set while an automatic rejoin is in progress; null otherwise. */
  reconnect: VoiceReconnectState | null;
  /** Why the last call ended involuntarily; cleared by a new join or a user hang-up. */
  lastEnded: VoiceEnded | null;
  /** The last user-started join that failed; cleared by a new join or dismissal. */
  joinFailure: VoiceJoinFailure | null;
}

export enum VoiceActionType {
  SetConnecting = 'SET_CONNECTING',
  SetConnected = 'SET_CONNECTED',
  SetDmConnected = 'SET_DM_CONNECTED',
  SetDisconnected = 'SET_DISCONNECTED',
  SetConnectionError = 'SET_CONNECTION_ERROR',
  SetDeafened = 'SET_DEAFENED',
  SetShowVideoTiles = 'SET_SHOW_VIDEO_TILES',
  SetPipCollapsed = 'SET_PIP_COLLAPSED',
  SetScreenShareAudioFailed = 'SET_SCREEN_SHARE_AUDIO_FAILED',
  SetSelectedAudioInputId = 'SET_SELECTED_AUDIO_INPUT_ID',
  SetSelectedAudioOutputId = 'SET_SELECTED_AUDIO_OUTPUT_ID',
  SetSelectedVideoInputId = 'SET_SELECTED_VIDEO_INPUT_ID',
  SetWasMutedBeforeDeafen = 'SET_WAS_MUTED_BEFORE_DEAFEN',
  SetServerMuted = 'SET_SERVER_MUTED',
  WatchCamera = 'WATCH_CAMERA',
  StopWatchingCamera = 'STOP_WATCHING_CAMERA',
  WatchScreenShare = 'WATCH_SCREEN_SHARE',
  StopWatchingScreenShare = 'STOP_WATCHING_SCREEN_SHARE',
  HideLocalTile = 'HIDE_LOCAL_TILE',
  ShowLocalTile = 'SHOW_LOCAL_TILE',
  SetStageMounted = 'SET_STAGE_MOUNTED',
  SetLayoutMode = 'SET_LAYOUT_MODE',
  TogglePinTile = 'TOGGLE_PIN_TILE',
  ToggleSpotlightTile = 'TOGGLE_SPOTLIGHT_TILE',
  SetReconnect = 'SET_RECONNECT',
  SetJoinFailure = 'SET_JOIN_FAILURE',
  /** Dismiss the voice notice (join failure / why the call ended). */
  ClearVoiceNotice = 'CLEAR_VOICE_NOTICE',
}

export type VoiceAction =
  | { type: VoiceActionType.SetConnecting; payload: boolean }
  | { type: VoiceActionType.SetConnected; payload: { channelId: string; channelName: string; communityId: string; isPrivate: boolean; createdAt: string } }
  | { type: VoiceActionType.SetDmConnected; payload: { dmGroupId: string; dmGroupName: string } }
  | { type: VoiceActionType.SetDisconnected; payload?: { reason: VoiceEndReason; error?: string | null } }
  | { type: VoiceActionType.SetConnectionError; payload: string }
  | { type: VoiceActionType.SetDeafened; payload: boolean }
  | { type: VoiceActionType.SetShowVideoTiles; payload: boolean }
  | { type: VoiceActionType.SetPipCollapsed; payload: boolean }
  | { type: VoiceActionType.SetScreenShareAudioFailed; payload: boolean }
  | { type: VoiceActionType.SetSelectedAudioInputId; payload: string | null }
  | { type: VoiceActionType.SetSelectedAudioOutputId; payload: string | null }
  | { type: VoiceActionType.SetSelectedVideoInputId; payload: string | null }
  | { type: VoiceActionType.SetWasMutedBeforeDeafen; payload: boolean }
  | { type: VoiceActionType.SetServerMuted; payload: boolean }
  | { type: VoiceActionType.WatchCamera; payload: string }
  | { type: VoiceActionType.StopWatchingCamera; payload: string }
  | { type: VoiceActionType.WatchScreenShare; payload: string }
  | { type: VoiceActionType.StopWatchingScreenShare; payload: string }
  | { type: VoiceActionType.HideLocalTile; payload: string }
  | { type: VoiceActionType.ShowLocalTile; payload: string }
  | { type: VoiceActionType.SetStageMounted; payload: boolean }
  | { type: VoiceActionType.SetLayoutMode; payload: VideoLayoutMode }
  | { type: VoiceActionType.TogglePinTile; payload: string }
  | { type: VoiceActionType.ToggleSpotlightTile; payload: string }
  | { type: VoiceActionType.SetReconnect; payload: VoiceReconnectState | null }
  | { type: VoiceActionType.SetJoinFailure; payload: Omit<VoiceJoinFailure, 'at'> }
  | { type: VoiceActionType.ClearVoiceNotice };

// Split into two contexts to avoid unnecessary re-renders
export const VoiceStateContext = createContext<VoiceState | null>(null);
export const VoiceDispatchContext = createContext<{
  dispatch: Dispatch<VoiceAction>;
  stateRef: RefObject<VoiceState>;
} | null>(null);

/** Read voice state (re-renders on changes) */
export function useVoice(): VoiceState {
  const ctx = useContext(VoiceStateContext);
  if (!ctx) throw new Error('useVoice must be used within a VoiceProvider');
  return ctx;
}

/** Get voice dispatch + stateRef (stable, no re-renders from state changes) */
export function useVoiceDispatch() {
  const ctx = useContext(VoiceDispatchContext);
  if (!ctx) throw new Error('useVoiceDispatch must be used within a VoiceProvider');
  return ctx;
}

/**
 * Like `useVoiceDispatch`, but returns null outside a VoiceProvider instead of
 * throwing — for hooks used by panels that are also rendered standalone.
 */
export function useOptionalVoiceDispatch() {
  return useContext(VoiceDispatchContext);
}
