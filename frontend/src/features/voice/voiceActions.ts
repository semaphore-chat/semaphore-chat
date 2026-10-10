// LiveKit (livekit-client) is heavyweight (~large chunk with hls.js-adjacent
// media deps) and previously loaded eagerly for every user via this static
// import, even users who never join voice. Only TYPES are imported here now
// — the runtime module is dynamically imported inside connectToLiveKitRoom(),
// the single place a Room is constructed, so the bytes only download when a
// user actually joins a voice/DM call (see PR-11 bundle splitting).
import type { Room, DisconnectReason, VideoCaptureOptions, AudioCaptureOptions } from "livekit-client";
import { VoiceSessionType, VoiceActionType, type VoiceAction, type VoiceState, type VoiceEndReason } from "../../contexts/VoiceContext";
import { livekitControllerGenerateToken, livekitControllerGenerateDmToken, voicePresenceControllerJoinPresence, voicePresenceControllerLeavePresence, voicePresenceControllerUpdateDeafenState } from "../../api-client/sdk.gen";
import { queryClient } from "../../queryClient";

import { getScreenShareSettings, DEFAULT_SCREEN_SHARE_SETTINGS } from "../../utils/screenShareState";
import { getScreenShareAudioConfig } from "../../utils/screenShareResolution";
import { getMicPublishDefaults, type MicQuality } from "../../utils/voiceQuality";
import { publishScreenShare } from "./screenSharePublish";
import { logger } from "../../utils/logger";
import { isElectron } from "../../utils/platform";
import { getCachedItem, setCachedItem, removeCachedItem } from "../../utils/storage";
import { getAccessToken } from "../../utils/tokenService";
import { getApiUrl } from "../../config/env";
import { playSound, Sounds } from "../../hooks/useSound";
import { setUpdateDeferred } from "../../utils/swUpdate";
import { cancelVoiceReconnect } from "./reconnectControl";

// Storage key must match useDeviceSettings.ts
const DEVICE_PREFERENCES_KEY = 'semaphore_device_preferences';
// Storage key must match useVoiceSettings.ts
const VOICE_SETTINGS_KEY = 'semaphore_voice_settings';
// Storage key for voice connection recovery
const VOICE_CONNECTION_KEY = 'semaphore_voice_connection';
// Connection state expires after 5 minutes (used for recovery on page refresh)
const CONNECTION_EXPIRY_MS = 5 * 60 * 1000;
/** How long a hang-up waits for the REST presence leave before aborting it. */
export const LEAVE_REST_TIMEOUT_MS = 3000;
/** How long a join waits for the microphone before joining muted. */
export const MIC_ENABLE_TIMEOUT_MS = 5000;

// =============================================================================
// PENDING JOIN (one join at a time; a hang-up cancels it)
// =============================================================================

/**
 * The join in flight, if any. Only one runs at a time: a second join while
 * one is pending (a double-click on a channel row) is ignored, and a hang-up
 * while "Connecting…" cancels it (`room.disconnect()` aborts `room.connect()`).
 */
export interface PendingJoin {
  /** 'user' = a join the user started; 'rejoin' = an automatic rejoin after a drop. */
  kind: 'user' | 'rejoin';
  channelId?: string;
  dmGroupId?: string;
  cancelled: boolean;
  /** The Room being connected, once constructed. */
  room: Room | null;
}

let pendingJoin: PendingJoin | null = null;

/** Thrown inside a join once it has been cancelled; never escapes the join. */
class JoinCancelledError extends Error {
  constructor() {
    super('Voice join cancelled');
    this.name = 'JoinCancelledError';
  }
}

export function getPendingJoin(): PendingJoin | null {
  return pendingJoin;
}

/**
 * Claim the single join slot. Returns null when a join is already pending
 * (the caller should do nothing), except that a user join takes over from an
 * automatic rejoin (cancelling it): the user picked where they want to be.
 */
export function beginJoin(target: Omit<PendingJoin, 'cancelled' | 'room'>): PendingJoin | null {
  if (pendingJoin) {
    if (target.kind === 'user' && pendingJoin.kind === 'rejoin') {
      cancelPendingJoin();
    } else {
      logger.info('[Voice] A join is already in progress; ignoring this one');
      return null;
    }
  }
  pendingJoin = { ...target, cancelled: false, room: null };
  return pendingJoin;
}

export function endJoin(join: PendingJoin): void {
  if (pendingJoin === join) {
    pendingJoin = null;
  }
}

/** Cancel the pending join, if any (aborting its room.connect()). */
export function cancelPendingJoin(): PendingJoin | null {
  const join = pendingJoin;
  if (!join) return null;
  pendingJoin = null;
  join.cancelled = true;
  if (join.room) {
    logger.info('[Voice] Cancelling the pending join');
    void join.room.disconnect().catch(() => {});
  }
  return join;
}

function throwIfCancelled(join: PendingJoin | undefined): void {
  if (join?.cancelled) {
    throw new JoinCancelledError();
  }
}

// =============================================================================
// MICROPHONE INTENT (for a mic enable that settles after its timeout)
// =============================================================================

/**
 * The mic state the user last asked for per room (toggle / undeafen). A join
 * whose mic enable times out tells the user they joined muted; if the enable
 * then succeeds late, the mic is turned off again unless the user has since
 * unmuted on purpose.
 */
const micIntent = new WeakMap<Room, boolean>();

function noteMicIntent(room: Room, enabled: boolean): void {
  micIntent.set(room, enabled);
}

interface DevicePreferences {
  audioInputDeviceId: string;
  audioOutputDeviceId: string;
  videoInputDeviceId: string;
}

interface VoiceSettings {
  inputMode: 'voice_activity' | 'push_to_talk';
  pushToTalkKey: string;
  pushToTalkKeyDisplay: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  voiceIsolation?: boolean;
  micQuality?: MicQuality;
}

// Exported for use by useVoiceRecovery hook
export interface SavedVoiceConnection {
  contextType: VoiceSessionType;
  channelId?: string;
  channelName?: string;
  communityId?: string;
  isPrivate?: boolean;
  createdAt?: string;
  dmGroupId?: string;
  dmGroupName?: string;
  /**
   * Mic was off when last seen (joined muted, or muted since), so a recovery
   * rejoin keeps it off. Absent in records saved before this field existed:
   * treated as unmuted (the old behaviour).
   */
  micMuted?: boolean;
  timestamp: number;
}

function saveConnectionState(connection: Omit<SavedVoiceConnection, 'timestamp'>) {
  const savedConnection: SavedVoiceConnection = {
    ...connection,
    timestamp: Date.now(),
  };
  setCachedItem(VOICE_CONNECTION_KEY, savedConnection);
  logger.info('[Voice] Saved connection state for recovery:', savedConnection);
}

/**
 * Keep the saved connection's mic state current (it changes after the join:
 * mute toggles, deafen, push-to-talk, server mute). Keeps the original
 * timestamp; no-op when nothing is saved.
 */
function updateSavedMicMuted(micMuted: boolean) {
  const saved = getCachedItem<SavedVoiceConnection>(VOICE_CONNECTION_KEY);
  if (!saved || saved.micMuted === micMuted) return;
  setCachedItem(VOICE_CONNECTION_KEY, { ...saved, micMuted });
}

/** LiveKit protocol `TrackSource.MICROPHONE` (canPublishSources holds protocol values). */
const PROTOCOL_TRACK_SOURCE_MICROPHONE = 2;

/**
 * Whether the token lets this participant publish a microphone. The backend
 * (publishGrantFor) sends `canPublish: false` with no SPEAK, or a
 * `canPublishSources` list without MICROPHONE when only some sources are
 * allowed. Unknown permissions count as allowed.
 */
export function canPublishMicrophone(
  permissions: { canPublish?: boolean; canPublishSources?: readonly number[] } | undefined,
): boolean {
  if (!permissions) return true;
  if (permissions.canPublish === false) return false;
  const sources = permissions.canPublishSources;
  if (sources && sources.length > 0 && !sources.includes(PROTOCOL_TRACK_SOURCE_MICROPHONE)) return false;
  return true;
}

function clearConnectionState() {
  removeCachedItem(VOICE_CONNECTION_KEY);
  logger.info('[Voice] Cleared saved connection state');
}

export function getSavedConnection(): SavedVoiceConnection | null {
  const saved = getCachedItem<SavedVoiceConnection>(VOICE_CONNECTION_KEY);
  if (!saved) return null;

  const age = Date.now() - saved.timestamp;
  if (age > CONNECTION_EXPIRY_MS) {
    logger.info('[Voice] Saved connection expired (age:', age, 'ms)');
    removeCachedItem(VOICE_CONNECTION_KEY);
    return null;
  }

  return saved;
}

export { clearConnectionState as clearSavedConnection };

function getAudioCaptureOptions(): AudioCaptureOptions {
  const settings = getCachedItem<VoiceSettings>(VOICE_SETTINGS_KEY);
  return {
    echoCancellation: settings?.echoCancellation ?? true,
    noiseSuppression: settings?.noiseSuppression ?? true,
    autoGainControl: settings?.autoGainControl ?? true,
    voiceIsolation: settings?.voiceIsolation ?? false,
  };
}

/**
 * Room options. Exported for tests.
 *
 * - adaptiveStream: subscribers ask the SFU for the simulcast layer that fits
 *   the element a video is rendered in, and pause video nobody can see, so
 *   tiles get low layers and a focused share the top one
 *   (screenShareViewQuality.ts covers a share larger than the viewer's screen).
 * - dynacast: publishers stop encoding layers nobody subscribes to, so the
 *   uncapped top layer of a screen share costs nothing until someone watches it.
 * - publishDefaults: the mic bitrate/DTX/RED from Settings → Voice & Video.
 *   Screen shares pass their own encoding (screenSharePublish.ts).
 */
export function getRoomOptions() {
  const settings = getCachedItem<VoiceSettings>(VOICE_SETTINGS_KEY);
  return {
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: getMicPublishDefaults(settings?.micQuality),
  };
}

/** Deps passed to each voice action */
interface VoiceActionDeps {
  dispatch: React.Dispatch<VoiceAction>;
  getVoiceState: () => VoiceState;
  getRoom: () => Room | null;
  setRoom: (room: Room | null) => void;
}

function dispatchSelectedDevice(
  dispatch: React.Dispatch<VoiceAction>,
  kind: MediaDeviceKind,
  deviceId: string
) {
  if (kind === 'audioinput') {
    dispatch({ type: VoiceActionType.SetSelectedAudioInputId, payload: deviceId });
  } else if (kind === 'audiooutput') {
    dispatch({ type: VoiceActionType.SetSelectedAudioOutputId, payload: deviceId });
  } else if (kind === 'videoinput') {
    dispatch({ type: VoiceActionType.SetSelectedVideoInputId, payload: deviceId });
  }
}

/**
 * Handle OS-level device changes (plug/unplug) during an active call.
 *
 * livekit-client's built-in devicechange handling follows OS-default changes,
 * but on Chromium it never moves audio input off a device that was unplugged,
 * and it never returns to a preferred device that was plugged back in (#346).
 * This runs after LiveKit's own handler (it fires on RoomEvent.MediaDevicesChanged,
 * which LiveKit emits once its handling is done).
 */
async function handleMediaDevicesChanged(
  room: Room,
  dispatch: React.Dispatch<VoiceAction>
) {
  if (room.state !== 'connected') return;

  try {
    const prefs = getCachedItem<DevicePreferences>(DEVICE_PREFERENCES_KEY);
    const devices = await navigator.mediaDevices.enumerateDevices();

    const kinds: { kind: MediaDeviceKind; preferred: string | undefined }[] = [
      { kind: 'audioinput', preferred: prefs?.audioInputDeviceId },
      { kind: 'audiooutput', preferred: prefs?.audioOutputDeviceId },
    ];

    for (const { kind, preferred } of kinds) {
      const available = devices.filter(d => d.kind === kind);
      if (available.length === 0) continue;

      const active = room.getActiveDevice(kind);

      // The user's preferred device was plugged back in — return to it
      if (preferred && preferred !== 'default' && preferred !== active &&
          available.some(d => d.deviceId === preferred)) {
        await room.switchActiveDevice(kind, preferred);
        dispatchSelectedDevice(dispatch, kind, preferred);
        logger.info('[Voice] Preferred', kind, 'device reconnected, switched back to:', preferred);
        continue;
      }

      // The active device was unplugged — fall back to the default device
      if (active && active !== 'default' && !available.some(d => d.deviceId === active)) {
        const fallback = available.some(d => d.deviceId === 'default')
          ? 'default'
          : available[0].deviceId;
        await room.switchActiveDevice(kind, fallback);
        dispatchSelectedDevice(dispatch, kind, fallback);
        logger.info('[Voice] Active', kind, 'device disconnected, fell back to:', fallback);
      }
    }
  } catch (error) {
    logger.warn('[Voice] Failed to handle media device change:', error);
  }
}

/**
 * Shared helper to connect to LiveKit room and enable microphone
 */
async function connectToLiveKitRoom(
  url: string,
  token: string,
  setRoom: (room: Room | null) => void,
  dispatch: React.Dispatch<VoiceAction>,
  options: { startMuted?: boolean; pending?: PendingJoin } = {},
): Promise<Room> {
  logger.info('[Voice] Creating new LiveKit room instance');
  // Dynamically import livekit-client (and its Web Worker timer shim) here —
  // this is the ONLY place a Room is constructed, so this await is what
  // pulls the livekit chunk over the network. The caller already dispatches
  // SetConnecting (isConnecting: true) before calling this function, so the
  // existing "Connecting…" UI covers the chunk-load latency on first join —
  // no new loading state needed.
  const [{ Room, RoomEvent, DisconnectReason }, { installLivekitWorkerTimers }] = await Promise.all([
    import("livekit-client"),
    import("../../utils/livekitWorkerTimers"),
  ]);
  // Route livekit's connection-critical timers through a Web Worker so
  // background-tab timer throttling can't starve ping/pong on mobile (#350).
  installLivekitWorkerTimers();
  throwIfCancelled(options.pending);
  const room = new Room(getRoomOptions());
  if (options.pending) {
    // A hang-up from here on disconnects this room, which aborts connect().
    options.pending.room = room;
  }

  // Register connection state monitoring before connecting so we catch
  // any events that fire during the connection handshake.
  room.on(RoomEvent.Reconnecting, () => {
    logger.warn('[Voice] LiveKit reconnecting...');
  });
  room.on(RoomEvent.Reconnected, () => {
    logger.info('[Voice] LiveKit reconnected');
  });
  room.on(RoomEvent.SignalConnected, () => {
    logger.info('[Voice] LiveKit signal connected');
  });
  room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
    if (reason === DisconnectReason.CLIENT_INITIATED) {
      logger.info('[Voice] LiveKit disconnected by client');
      return;
    }
    logger.error('[Voice] LiveKit disconnected unexpectedly, reason:', reason);
  });
  // Keep voice state in sync when LiveKit switches devices on its own
  // (OS default change, device plugged/unplugged mid-call).
  room.on(RoomEvent.ActiveDeviceChanged, (kind: MediaDeviceKind, deviceId: string) => {
    logger.info('[Voice] Active device changed:', kind, deviceId);
    dispatchSelectedDevice(dispatch, kind, deviceId);
  });
  room.on(RoomEvent.MediaDevicesChanged, () => handleMediaDevicesChanged(room, dispatch));
  // Remember the mic state for a recovery rejoin (see SavedVoiceConnection.micMuted)
  const syncSavedMic = () => updateSavedMicMuted(!room.localParticipant.isMicrophoneEnabled);
  room.on(RoomEvent.TrackMuted, syncSavedMic);
  room.on(RoomEvent.TrackUnmuted, syncSavedMic);
  room.on(RoomEvent.LocalTrackPublished, syncSavedMic);
  room.on(RoomEvent.LocalTrackUnpublished, syncSavedMic);

  try {
    logger.info('[Voice] Connecting to LiveKit server:', url);
    // autoSubscribe belongs in RoomConnectOptions (connect()'s third arg), NOT
    // the Room constructor — livekit-client silently ignores unknown constructor
    // options, which is why this was a no-op for the product's entire life until
    // #365. With auto-subscribe OFF, the SFU sends nothing until we ask: the
    // manual subscription layer (useTrackSubscription) owns every subscription
    // decision — mic subscribed immediately, camera/screen-share opt-in per the
    // watch/placeholder UX.
    await room.connect(url, token, { autoSubscribe: false });
    logger.info('[Voice] Connected to LiveKit room, state:', room.state);
    throwIfCancelled(options.pending);
    setRoom(room);

    const initialMetadata = JSON.stringify({ isDeafened: false });
    await room.localParticipant.setMetadata(initialMetadata);
    logger.info('[Voice] Set initial participant metadata');
  } catch (error) {
    if (options.pending?.cancelled) {
      throw new JoinCancelledError();
    }
    logger.error('[Voice] Failed to connect to LiveKit room:', error);
    throw error;
  }

  const voiceSettings = getCachedItem<VoiceSettings>(VOICE_SETTINGS_KEY);
  const isPushToTalk = voiceSettings?.inputMode === 'push_to_talk';

  // No SPEAK in this channel: the token can't publish a mic, so don't try
  // (and don't wait up to 5s for it to fail) — whichever way the join came
  // (sidebar, pre-join while permissions are still loading, recovery).
  const micAllowed = canPublishMicrophone(
    room.localParticipant.permissions as { canPublish?: boolean; canPublishSources?: number[] } | undefined,
  );

  if (isPushToTalk || options.startMuted || !micAllowed) {
    // Push-to-talk, "Join muted" and listen-only joins start with the mic off.
    logger.info(
      `[Voice] ${isPushToTalk ? 'Push to Talk mode' : micAllowed ? 'Joining muted' : 'Listen-only (no mic permission)'} - microphone starts disabled`,
    );
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
    } catch {
      // Ignore errors, mic might already be disabled
    }
  } else {
    logger.info('[Voice] Voice Activity mode - attempting to enable microphone...');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const micPromise = room.localParticipant.setMicrophoneEnabled(true, getAudioCaptureOptions());
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Microphone enable timeout (${MIC_ENABLE_TIMEOUT_MS / 1000}s)`));
        }, MIC_ENABLE_TIMEOUT_MS);
      });
      await Promise.race([micPromise, timeoutPromise]);
      logger.info('[Voice] Microphone enabled successfully');
    } catch (error) {
      logger.warn('[Voice] Failed to enable microphone (user will join muted):', error);
      if (timedOut) {
        // The enable can still succeed later: keep the mic off unless the
        // user has unmuted since (they were told they joined muted).
        micPromise.then(
          () => {
            if (micIntent.get(room) !== true && room.localParticipant.isMicrophoneEnabled) {
              logger.info('[Voice] Late microphone enable after the timeout — turning it off again');
              room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
            }
          },
          () => {},
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const savedPreferences = getCachedItem<DevicePreferences>(DEVICE_PREFERENCES_KEY);
  // Without a saved preference, bind to the browser's 'default' pseudo-device:
  // Chromium reroutes 'default'-bound tracks when the OS default changes, which
  // is what makes plugging in a headset mid-call switch audio over (#346).
  // Browsers without a 'default' device (Firefox/Safari) skip this via the
  // existence check below — LiveKit's own devicechange handling covers them.
  const preferredAudioInput = savedPreferences?.audioInputDeviceId || 'default';
  const preferredAudioOutput = savedPreferences?.audioOutputDeviceId || 'default';
  logger.info('[Voice] Applying device preferences:', { preferredAudioInput, preferredAudioOutput });

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputDevices = devices.filter(d => d.kind === 'audioinput');
    const audioOutputDevices = devices.filter(d => d.kind === 'audiooutput');

    if (audioInputDevices.some(d => d.deviceId === preferredAudioInput)) {
      await room.switchActiveDevice('audioinput', preferredAudioInput);
      logger.info('[Voice] Applied audio input device:', preferredAudioInput);
    } else {
      logger.warn('[Voice] Audio input device not available, leaving browser default. Wanted:', preferredAudioInput);
      logger.info('[Voice] Available audio input devices:', audioInputDevices.map(d => ({ id: d.deviceId, label: d.label })));
    }

    if (audioOutputDevices.some(d => d.deviceId === preferredAudioOutput)) {
      await room.switchActiveDevice('audiooutput', preferredAudioOutput);
      logger.info('[Voice] Applied audio output device:', preferredAudioOutput);
    } else {
      logger.warn('[Voice] Audio output device not available, leaving browser default. Wanted:', preferredAudioOutput);
    }
  } catch (error) {
    logger.warn('[Voice] Failed to apply device preferences:', error);
  }

  logger.info('[Voice] Room connection complete');
  return room;
}

// =============================================================================
// CHANNEL VOICE ACTIONS
// =============================================================================

interface JoinVoiceChannelParams {
  channelId: string;
  channelName: string;
  communityId: string;
  isPrivate: boolean;
  createdAt: string;
  user: { id: string; username: string; displayName?: string };
  connectionInfo: { url: string };
  /** Join with the microphone off ("Join muted", or listen-only). */
  startMuted?: boolean;
  /** An automatic rejoin: no connect sound (the call never ended for the user). */
  quiet?: boolean;
  /** The join slot the caller already claimed (beginJoin); claimed here when absent. */
  claimedJoin?: PendingJoin;
}

export async function joinVoiceChannel(
  params: JoinVoiceChannelParams,
  deps: VoiceActionDeps
) {
  const { channelId, channelName, communityId, isPrivate, createdAt, user, connectionInfo, startMuted, quiet } = params;
  const { dispatch, setRoom } = deps;

  // Use the caller's claim (useVoiceConnection claims before leaving the
  // previous call) or claim the join slot here; a second concurrent join is
  // ignored.
  const ownJoin = params.claimedJoin ? null : beginJoin({ kind: quiet ? 'rejoin' : 'user', channelId });
  const join = params.claimedJoin ?? ownJoin;
  if (!join) return;

  logger.info('[Voice] === Starting voice channel join ===');
  logger.info('[Voice] Channel:', channelId, channelName);
  logger.info('[Voice] User:', user.id, user.displayName || user.username);

  try {
    dispatch({ type: VoiceActionType.SetConnecting, payload: true });

    logger.info('[Voice] Requesting LiveKit token...');
    // A 401 is handled by the API client's response interceptor, which
    // refreshes the session and retries the request (api-client-config.ts).
    const { data: tokenResponse } = await livekitControllerGenerateToken({
      body: { roomId: channelId, identity: user.id, name: user.displayName || user.username },
      throwOnError: true,
    });
    logger.info('[Voice] Got LiveKit token');

    logger.info('[Voice] Connecting to LiveKit room...');
    throwIfCancelled(join);
    const room = await connectToLiveKitRoom(connectionInfo.url, tokenResponse.token, setRoom, dispatch, { startMuted, pending: join });
    throwIfCancelled(join);

    dispatch({
      type: VoiceActionType.SetConnected,
      payload: { channelId, channelName, communityId, isPrivate, createdAt },
    });

    // Suppress the "Update available" reload prompt while in a call — a
    // mid-call SW reload would drop the connection (see swUpdate / UpdateToast).
    setUpdateDeferred(true);

    // Register presence directly (belt-and-suspenders alongside LiveKit webhooks)
    try {
      await voicePresenceControllerJoinPresence({ path: { channelId } });
      logger.info('[Voice] Registered voice presence via REST');
    } catch (err) {
      logger.warn('[Voice] Failed to register voice presence (webhook will handle it):', err);
    }

    queryClient.invalidateQueries({ queryKey: [{ _id: 'voicePresenceControllerGetChannelPresence' }] });
    queryClient.invalidateQueries({ queryKey: [{ _id: 'userVoicePresenceControllerGetMyVoiceChannels' }] });
    queryClient.invalidateQueries({ queryKey: [{ _id: 'dmVoicePresenceControllerGetDmPresence' }] });

    saveConnectionState({
      contextType: VoiceSessionType.Channel,
      channelId,
      channelName,
      communityId,
      isPrivate,
      createdAt,
      micMuted: !room.localParticipant.isMicrophoneEnabled,
    });

    if (!quiet) playSound(Sounds.connected);
    logger.info('[Voice] === Voice channel join complete ===');
  } catch (error) {
    if (join.cancelled || error instanceof JoinCancelledError) {
      // Hung up while connecting: the hang-up already reset the state.
      logger.info('[Voice] Voice channel join cancelled');
      discardCancelledRoom(join, deps);
      return;
    }
    logger.error("[Voice] Failed to join voice channel:", error);
    const message = error instanceof Error ? error.message : "Failed to join voice channel";
    dispatch({ type: VoiceActionType.SetConnectionError, payload: message });
    setRoom(null);
    throw error;
  } finally {
    if (ownJoin) endJoin(ownJoin);
  }
}

/** A join was cancelled after its room connected: drop that room. */
function discardCancelledRoom(join: PendingJoin, deps: VoiceActionDeps) {
  const room = join.room;
  if (!room) return;
  void room.disconnect().catch(() => {});
  if (deps.getRoom() === room) {
    deps.setRoom(null);
  }
}

interface LeaveOptions {
  /**
   * Leave the previous call without cancelling the pending join: used by a
   * join that has already claimed the slot and leaves the old call first.
   */
  keepPendingJoin?: boolean;
}

/** Best-effort REST presence leave, aborted after LEAVE_REST_TIMEOUT_MS; never awaited by the hang-up. */
function sendLeavePresence(channelId: string): void {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LEAVE_REST_TIMEOUT_MS);
  voicePresenceControllerLeavePresence({ path: { channelId }, signal: controller.signal })
    .then(() => logger.info('[Voice] Removed voice presence via REST'))
    .catch((err) => logger.warn('[Voice] Failed to remove voice presence (webhook will handle it):', err))
    .finally(() => clearTimeout(timer));
}

/** Tear down a room: soundboard graph and LiveKit connection, in parallel. */
async function disposeRoom(room: Room): Promise<void> {
  const { soundboardPlayer } = await import("./soundboardPlayer");
  const results = await Promise.allSettled([
    soundboardPlayer.dispose(room),
    room.disconnect(),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn('[Voice] Error while disconnecting the room:', result.reason);
    }
  }
}

/**
 * Hang up (channel or DM): cancels a pending join or a running rejoin loop,
 * updates the UI at once, and disconnects LiveKit. The REST presence leave
 * runs in the background with a timeout, so a dead network never holds up
 * the hang-up.
 */
async function leaveVoice(deps: VoiceActionDeps, options: LeaveOptions = {}) {
  const { dispatch, getVoiceState, getRoom, setRoom } = deps;
  const state = getVoiceState();
  const room = getRoom();

  cancelVoiceReconnect();
  const cancelledJoin = options.keepPendingJoin ? null : cancelPendingJoin();
  const { currentChannelId } = state;

  if (!room && !cancelledJoin && !currentChannelId && !state.currentDmGroupId && !state.isConnecting) {
    logger.warn('[Voice] leave: nothing to leave');
    return;
  }

  logger.info('[Voice] === Leaving voice ===', { channelId: currentChannelId, dmGroupId: state.currentDmGroupId });

  // Optimistic: the UI shows the call as over right away.
  setRoom(null);
  dispatch({ type: VoiceActionType.SetDisconnected });
  clearConnectionState();
  setUpdateDeferred(false);
  if (state.isConnected) {
    playSound(Sounds.disconnected);
  }

  if (currentChannelId && state.isConnected) {
    sendLeavePresence(currentChannelId);
  }

  if (room) {
    await disposeRoom(room);
  }
  logger.info('[Voice] === Voice leave complete ===');
}

export async function leaveVoiceChannel(deps: VoiceActionDeps, options: LeaveOptions = {}) {
  await leaveVoice(deps, options);
}

/**
 * End the call without a hang-up from the user (removed, duplicate login,
 * room deleted, every rejoin failed). No REST leave: the server already
 * knows, and for a duplicate identity it would remove the other device's
 * presence. Records the reason in voice state for the UI.
 */
export async function endVoiceSession(
  reason: VoiceEndReason,
  deps: VoiceActionDeps,
  error: string | null = null,
) {
  const { dispatch, getRoom, setRoom } = deps;
  const room = getRoom();
  cancelVoiceReconnect();
  cancelPendingJoin();
  logger.warn('[Voice] Voice session ended:', reason, error ?? '');

  setRoom(null);
  dispatch({ type: VoiceActionType.SetDisconnected, payload: { reason, error } });
  // Don't let a page refresh rejoin (it would kick the other device).
  clearConnectionState();
  setUpdateDeferred(false);
  playSound(Sounds.disconnected);

  if (room) {
    await disposeRoom(room);
  }
}

/**
 * Drop a dead room before an automatic rejoin, without any of a hang-up's
 * side effects (REST leave, sounds, state reset): the bar stays up showing
 * "Reconnecting".
 */
export async function discardRoomForRejoin(deps: VoiceActionDeps) {
  const room = deps.getRoom();
  if (!room) return;
  deps.setRoom(null);
  await disposeRoom(room);
}

// =============================================================================
// DM VOICE ACTIONS
// =============================================================================

interface JoinDmVoiceParams {
  dmGroupId: string;
  dmGroupName: string;
  user: { id: string; username: string; displayName?: string };
  connectionInfo: { url: string };
  /** Join with the microphone off (a rejoin keeps the mic state). */
  startMuted?: boolean;
  /** An automatic rejoin: no connect sound. */
  quiet?: boolean;
  /** The join slot the caller already claimed (beginJoin); claimed here when absent. */
  claimedJoin?: PendingJoin;
}

export async function joinDmVoice(
  params: JoinDmVoiceParams,
  deps: VoiceActionDeps
) {
  const { dmGroupId, dmGroupName, user, connectionInfo, startMuted, quiet } = params;
  const { dispatch, setRoom } = deps;

  const ownJoin = params.claimedJoin ? null : beginJoin({ kind: quiet ? 'rejoin' : 'user', dmGroupId });
  const join = params.claimedJoin ?? ownJoin;
  if (!join) return;

  try {
    dispatch({ type: VoiceActionType.SetConnecting, payload: true });

    // A 401 is handled by the API client's response interceptor, which
    // refreshes the session and retries the request (api-client-config.ts).
    const { data: tokenResponse } = await livekitControllerGenerateDmToken({
      body: { roomId: dmGroupId, identity: user.id, name: user.displayName || user.username },
      throwOnError: true,
    });

    throwIfCancelled(join);
    await connectToLiveKitRoom(connectionInfo.url, tokenResponse.token, setRoom, dispatch, { startMuted, pending: join });
    throwIfCancelled(join);

    dispatch({
      type: VoiceActionType.SetDmConnected,
      payload: { dmGroupId, dmGroupName },
    });

    // Suppress the update-reload prompt while in a call (see above).
    setUpdateDeferred(true);

    queryClient.invalidateQueries({ queryKey: [{ _id: 'voicePresenceControllerGetChannelPresence' }] });
    queryClient.invalidateQueries({ queryKey: [{ _id: 'userVoicePresenceControllerGetMyVoiceChannels' }] });
    queryClient.invalidateQueries({ queryKey: [{ _id: 'dmVoicePresenceControllerGetDmPresence' }] });

    saveConnectionState({
      contextType: VoiceSessionType.Dm,
      dmGroupId,
      dmGroupName,
    });

    if (!quiet) playSound(Sounds.connected);
  } catch (error) {
    if (join.cancelled || error instanceof JoinCancelledError) {
      logger.info('[Voice] DM voice join cancelled');
      discardCancelledRoom(join, deps);
      return;
    }
    logger.error("Failed to join DM voice call:", error);
    const message = error instanceof Error ? error.message : "Failed to join DM voice call";
    dispatch({ type: VoiceActionType.SetConnectionError, payload: message });
    setRoom(null);
    throw error;
  } finally {
    if (ownJoin) endJoin(ownJoin);
  }
}

export async function leaveDmVoice(deps: VoiceActionDeps, options: LeaveOptions = {}) {
  await leaveVoice(deps, options);
}

// =============================================================================
// UNIFIED MEDIA ACTIONS
// =============================================================================

export async function toggleMicrophone(deps: VoiceActionDeps) {
  const { getVoiceState, getRoom } = deps;
  const state = getVoiceState();
  const { currentChannelId, currentDmGroupId } = state;
  const room = getRoom();

  if (!room || (!currentChannelId && !currentDmGroupId)) {
    logger.warn('[Voice] toggleMicrophone: No room or channel/DM');
    return;
  }

  const isCurrentlyEnabled = room.localParticipant.isMicrophoneEnabled;
  const newState = !isCurrentlyEnabled;

  // Block unmute when server-muted
  if (newState && state.isServerMuted) {
    logger.warn('[Voice] toggleMicrophone: Blocked — user is server muted');
    return;
  }

  logger.info('[Voice] Toggling microphone:', isCurrentlyEnabled, '->', newState);

  try {
    noteMicIntent(room, newState);
    await room.localParticipant.setMicrophoneEnabled(newState, newState ? getAudioCaptureOptions() : undefined);
    playSound(newState ? Sounds.toggleOn : Sounds.toggleOff);
    logger.info('[Voice] Microphone toggled successfully');
  } catch (error) {
    logger.error("[Voice] Failed to toggle microphone:", error);
    throw error;
  }
}

/**
 * Play a soundboard sound to everyone in the voice channel.
 *
 * Fetches the authenticated audio blob for `fileId`, then hands it to the
 * WebAudio-backed soundboard player which publishes a mixed track into the
 * LiveKit room (audible to remote participants) and monitors locally.
 */
export async function playSoundboard(fileId: string, deps: VoiceActionDeps) {
  const room = deps.getRoom();
  if (!room) {
    logger.warn('[Voice] playSoundboard: not connected to a room');
    return;
  }

  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(getApiUrl(`/file/${fileId}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch soundboard sound (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();

  const { soundboardPlayer } = await import("./soundboardPlayer");
  await soundboardPlayer.play(room, fileId, arrayBuffer);
}

export async function toggleCameraUnified(deps: VoiceActionDeps) {
  const { getVoiceState, getRoom } = deps;
  const { currentChannelId, currentDmGroupId, selectedVideoInputId } = getVoiceState();
  const room = getRoom();

  if (!room || (!currentChannelId && !currentDmGroupId)) {
    logger.warn('[Voice] toggleCamera: No room or channel/DM');
    return;
  }

  if (room.state !== 'connected') {
    logger.error('[Voice] toggleCamera: Room not connected, state:', room.state);
    throw new Error('Room is not connected');
  }

  const isCurrentlyEnabled = room.localParticipant.isCameraEnabled;
  const newState = !isCurrentlyEnabled;
  logger.info('[Voice] Toggling camera:', isCurrentlyEnabled, '->', newState);

  try {
    const videoCaptureOptions: VideoCaptureOptions | undefined = newState
      ? {
          deviceId: selectedVideoInputId ? { ideal: selectedVideoInputId } : undefined,
          // VideoResolution takes plain numbers; livekit-client converts them
          // to ideal constraints when building getUserMedia constraints.
          resolution: {
            width: 1280,
            height: 720,
          },
        }
      : undefined;

    await room.localParticipant.setCameraEnabled(newState, videoCaptureOptions);
    playSound(newState ? Sounds.toggleOn : Sounds.toggleOff);
    logger.info('[Voice] Camera toggled successfully');
  } catch (error) {
    logger.error("[Voice] Failed to toggle camera:", error);
    throw error;
  }
}

export async function toggleScreenShareUnified(deps: VoiceActionDeps) {
  const { dispatch, getVoiceState, getRoom } = deps;
  const { currentChannelId, currentDmGroupId } = getVoiceState();
  const room = getRoom();

  if (!room || (!currentChannelId && !currentDmGroupId)) {
    logger.warn('[Voice] toggleScreenShare: No room or channel/DM');
    return;
  }

  if (room.state !== 'connected') {
    logger.error('[Voice] toggleScreenShare: Room not connected, state:', room.state);
    throw new Error('Room is not connected');
  }

  const isCurrentlySharing = room.localParticipant.isScreenShareEnabled;
  const newState = !isCurrentlySharing;
  logger.info('[Voice] Toggling screen share:', isCurrentlySharing, '->', newState);

  if (newState) {
    dispatch({ type: VoiceActionType.SetScreenShareAudioFailed, payload: false });
  }

  try {
    if (newState) {
      const settings = getScreenShareSettings() || DEFAULT_SCREEN_SHARE_SETTINGS;
      logger.info('[Voice] Screen share settings:', settings);

      const audioConfig = getScreenShareAudioConfig(settings.enableAudio !== false);

      logger.info('[Voice] Screen share audio config passed to LiveKit:', JSON.stringify(audioConfig));
      logger.info('[Voice] Platform:', isElectron() ? 'electron' : 'web');

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        logger.info('[Voice] Audio output devices:', audioOutputs.map(d => ({
          deviceId: d.deviceId.substring(0, 8) + '...',
          label: d.label,
          groupId: d.groupId.substring(0, 8) + '...',
        })));
        logger.info('[Voice] Audio input devices:', audioInputs.map(d => ({
          deviceId: d.deviceId.substring(0, 8) + '...',
          label: d.label,
        })));
      } catch (e) {
        logger.warn('[Voice] Could not enumerate devices for diagnostics:', e);
      }

      try {
        const ctx = new AudioContext();
        logger.info('[Voice] AudioContext:', {
          sampleRate: ctx.sampleRate,
          state: ctx.state,
          baseLatency: ctx.baseLatency,
          outputLatency: ctx.outputLatency,
        });
        await ctx.close();
      } catch (e) {
        logger.warn('[Voice] Could not create AudioContext for diagnostics:', e);
      }

      try {
        await publishScreenShare(room, settings, audioConfig);
        playSound(Sounds.screenShareStarted);
        logger.info('[Voice] Screen share enabled with audio');
      } catch (audioError) {
        if (audioError instanceof Error) {
          logger.error('[Voice] Screen share audio error details:', {
            name: audioError.name,
            message: audioError.message,
            stack: audioError.stack,
            code: (audioError as DOMException).code,
            constraint: (audioError as unknown as { constraint?: string }).constraint,
          });
        } else {
          logger.error('[Voice] Screen share audio error (non-Error):', audioError);
        }

        try {
          const postDevices = await navigator.mediaDevices.enumerateDevices();
          const postOutputs = postDevices.filter(d => d.kind === 'audiooutput');
          logger.info('[Voice] Audio devices after failure:', postOutputs.map(d => ({
            deviceId: d.deviceId.substring(0, 8) + '...',
            label: d.label,
          })));
        } catch {
          logger.warn('[Voice] Could not enumerate devices after failure');
        }

        const isAudioError = audioError instanceof Error && (
          audioError.name === 'NotReadableError' ||
          audioError.message.includes('Could not start audio source')
        );

        if (isAudioError && settings.enableAudio !== false) {
          logger.warn('[Voice] Audio capture failed, retrying without audio');

          await publishScreenShare(room, settings, false);

          dispatch({ type: VoiceActionType.SetScreenShareAudioFailed, payload: true });
          playSound(Sounds.screenShareStarted);
          logger.info('[Voice] Screen share enabled without audio (fallback)');
        } else {
          throw audioError;
        }
      }
    } else {
      await room.localParticipant.setScreenShareEnabled(false);
      dispatch({ type: VoiceActionType.SetScreenShareAudioFailed, payload: false });
      playSound(Sounds.screenShareStopped);
    }
    logger.info('[Voice] Screen share toggled successfully');
  } catch (error) {
    logger.error("[Voice] Failed to toggle screen share:", error);
    throw error;
  }
}

export async function toggleDeafenUnified(deps: VoiceActionDeps) {
  const { dispatch, getVoiceState, getRoom } = deps;
  const { isDeafened, currentChannelId, currentDmGroupId } = getVoiceState();

  if (!currentChannelId && !currentDmGroupId) return;

  const newDeafenedState = !isDeafened;
  const room = getRoom();

  try {
    dispatch({ type: VoiceActionType.SetDeafened, payload: newDeafenedState });

    if (room) {
      const currentMetadata = room.localParticipant.metadata;
      let metadata: Record<string, unknown> = {};
      try {
        metadata = currentMetadata ? JSON.parse(currentMetadata) : {};
      } catch {
        // Invalid existing metadata, start fresh
      }
      metadata.isDeafened = newDeafenedState;
      await room.localParticipant.setMetadata(JSON.stringify(metadata));
      logger.info('[Voice] Updated LiveKit metadata with isDeafened:', newDeafenedState);
    }

    // Notify backend so non-connected viewers see the deafen state change
    const channelId = currentChannelId;
    if (channelId) {
      voicePresenceControllerUpdateDeafenState({
        path: { channelId },
        body: { isDeafened: newDeafenedState },
      }).catch((err) => {
        logger.warn('[Voice] Failed to update deafen state on backend:', err);
      });
    }

    if (newDeafenedState && room) {
      const isMicEnabled = room.localParticipant.isMicrophoneEnabled;
      dispatch({ type: VoiceActionType.SetWasMutedBeforeDeafen, payload: !isMicEnabled });
      if (isMicEnabled) {
        await room.localParticipant.setMicrophoneEnabled(false);
      }
    } else if (!newDeafenedState && room) {
      // Restore mic state from before deafen (but not if server-muted)
      const currentState = getVoiceState();
      if (!currentState.wasMutedBeforeDeafen && !currentState.isServerMuted) {
        noteMicIntent(room, true);
        await room.localParticipant.setMicrophoneEnabled(true, getAudioCaptureOptions());
      }
      // Play sound only on undeafen — user can't hear it while deafened
      playSound(Sounds.toggleOn);
    }
  } catch (error) {
    logger.error("Failed to toggle deafen:", error);
    dispatch({ type: VoiceActionType.SetDeafened, payload: isDeafened });
    throw error;
  }
}

// =============================================================================
// DEVICE SWITCHING ACTIONS
// =============================================================================

export async function switchAudioInputDevice(
  deviceId: string,
  deps: VoiceActionDeps
) {
  const { dispatch, getVoiceState, getRoom } = deps;
  const { currentChannelId, currentDmGroupId } = getVoiceState();
  const room = getRoom();

  if (!room || (!currentChannelId && !currentDmGroupId)) return;

  try {
    await room.switchActiveDevice('audioinput', deviceId);
    dispatch({ type: VoiceActionType.SetSelectedAudioInputId, payload: deviceId });
    // Persist so the preference survives page refresh
    const saved = getCachedItem<DevicePreferences>(DEVICE_PREFERENCES_KEY);
    setCachedItem(DEVICE_PREFERENCES_KEY, { ...saved, audioInputDeviceId: deviceId });
    logger.info('[Voice] Switched audio input device:', deviceId);
  } catch (error) {
    logger.error("Failed to switch audio input device:", error);
    throw error;
  }
}

export async function switchAudioOutputDevice(
  deviceId: string,
  deps: VoiceActionDeps
) {
  const { dispatch, getVoiceState, getRoom } = deps;
  const { currentChannelId, currentDmGroupId } = getVoiceState();
  const room = getRoom();

  if (!room || (!currentChannelId && !currentDmGroupId)) return;

  try {
    await room.switchActiveDevice('audiooutput', deviceId);
    dispatch({ type: VoiceActionType.SetSelectedAudioOutputId, payload: deviceId });
    const saved = getCachedItem<DevicePreferences>(DEVICE_PREFERENCES_KEY);
    setCachedItem(DEVICE_PREFERENCES_KEY, { ...saved, audioOutputDeviceId: deviceId });
    logger.info('[Voice] Switched audio output device:', deviceId);
  } catch (error) {
    logger.error("Failed to switch audio output device:", error);
    throw error;
  }
}

export async function switchVideoInputDevice(
  deviceId: string,
  deps: VoiceActionDeps
) {
  const { dispatch, getVoiceState, getRoom } = deps;
  const { currentChannelId, currentDmGroupId } = getVoiceState();
  const room = getRoom();

  if (!room || (!currentChannelId && !currentDmGroupId)) return;

  try {
    await room.switchActiveDevice('videoinput', deviceId);
    dispatch({ type: VoiceActionType.SetSelectedVideoInputId, payload: deviceId });
    const saved = getCachedItem<DevicePreferences>(DEVICE_PREFERENCES_KEY);
    setCachedItem(DEVICE_PREFERENCES_KEY, { ...saved, videoInputDeviceId: deviceId });
  } catch (error) {
    logger.error("Failed to switch video input device:", error);
    throw error;
  }
}
