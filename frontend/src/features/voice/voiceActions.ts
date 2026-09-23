// LiveKit (livekit-client) is heavyweight (~large chunk with hls.js-adjacent
// media deps) and previously loaded eagerly for every user via this static
// import, even users who never join voice. Only TYPES are imported here now
// — the runtime module is dynamically imported inside connectToLiveKitRoom(),
// the single place a Room is constructed, so the bytes only download when a
// user actually joins a voice/DM call (see PR-11 bundle splitting).
import type { Room, DisconnectReason, VideoCaptureOptions, AudioCaptureOptions } from "livekit-client";
import { VoiceSessionType, VoiceActionType, type VoiceAction, type VoiceState } from "../../contexts/VoiceContext";
import { livekitControllerGenerateToken, livekitControllerGenerateDmToken, voicePresenceControllerJoinPresence, voicePresenceControllerLeavePresence, voicePresenceControllerUpdateDeafenState } from "../../api-client/sdk.gen";
import { queryClient } from "../../queryClient";

import { getScreenShareSettings, DEFAULT_SCREEN_SHARE_SETTINGS } from "../../utils/screenShareState";
import { getResolutionConfig, getScreenShareAudioConfig } from "../../utils/screenShareResolution";
import { logger } from "../../utils/logger";
import { isElectron } from "../../utils/platform";
import { getCachedItem, setCachedItem, removeCachedItem } from "../../utils/storage";
import { refreshToken as refreshAuthToken, getAccessToken } from "../../utils/tokenService";
import { getApiUrl } from "../../config/env";
import { playSound, Sounds } from "../../hooks/useSound";
import { setUpdateDeferred } from "../../utils/swUpdate";

// Storage key must match useDeviceSettings.ts
const DEVICE_PREFERENCES_KEY = 'semaphore_device_preferences';
// Storage key must match useVoiceSettings.ts
const VOICE_SETTINGS_KEY = 'semaphore_voice_settings';
// Storage key for voice connection recovery
const VOICE_CONNECTION_KEY = 'semaphore_voice_connection';
// Connection state expires after 5 minutes (used for recovery on page refresh)
const CONNECTION_EXPIRY_MS = 5 * 60 * 1000;

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
  dispatch: React.Dispatch<VoiceAction>
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
  const room = new Room();

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
    setRoom(room);

    const initialMetadata = JSON.stringify({ isDeafened: false });
    await room.localParticipant.setMetadata(initialMetadata);
    logger.info('[Voice] Set initial participant metadata');
  } catch (error) {
    logger.error('[Voice] Failed to connect to LiveKit room:', error);
    throw error;
  }

  const voiceSettings = getCachedItem<VoiceSettings>(VOICE_SETTINGS_KEY);
  const isPushToTalk = voiceSettings?.inputMode === 'push_to_talk';

  if (isPushToTalk) {
    logger.info('[Voice] Push to Talk mode - microphone starts disabled');
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
    } catch {
      // Ignore errors, mic might already be disabled
    }
  } else {
    logger.info('[Voice] Voice Activity mode - attempting to enable microphone...');
    try {
      const micPromise = room.localParticipant.setMicrophoneEnabled(true, getAudioCaptureOptions());
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Microphone enable timeout (5s)')), 5000)
      );
      await Promise.race([micPromise, timeoutPromise]);
      logger.info('[Voice] Microphone enabled successfully');
    } catch (error) {
      logger.warn('[Voice] Failed to enable microphone (user will join muted):', error);
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
}

export async function joinVoiceChannel(
  params: JoinVoiceChannelParams,
  deps: VoiceActionDeps
) {
  const { channelId, channelName, communityId, isPrivate, createdAt, user, connectionInfo } = params;
  const { dispatch, setRoom } = deps;

  logger.info('[Voice] === Starting voice channel join ===');
  logger.info('[Voice] Channel:', channelId, channelName);
  logger.info('[Voice] User:', user.id, user.displayName || user.username);

  try {
    dispatch({ type: VoiceActionType.SetConnecting, payload: true });

    logger.info('[Voice] Requesting LiveKit token...');
    let tokenResponse;
    try {
      const { data } = await livekitControllerGenerateToken({
        body: { roomId: channelId, identity: user.id, name: user.displayName || user.username },
        throwOnError: true,
      });
      tokenResponse = data;
    } catch (error) {
      // If 401, try refreshing the access token and retry once
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('Unauthorized'))) {
        logger.warn('[Voice] Token may be stale, attempting refresh...');
        await refreshAuthToken();
        const { data } = await livekitControllerGenerateToken({
          body: { roomId: channelId, identity: user.id, name: user.displayName || user.username },
          throwOnError: true,
        });
        tokenResponse = data;
      } else {
        throw error;
      }
    }
    logger.info('[Voice] Got LiveKit token');

    logger.info('[Voice] Connecting to LiveKit room...');
    await connectToLiveKitRoom(connectionInfo.url, tokenResponse.token, setRoom, dispatch);

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
    });

    playSound(Sounds.connected);
    logger.info('[Voice] === Voice channel join complete ===');
  } catch (error) {
    logger.error("[Voice] Failed to join voice channel:", error);
    const message = error instanceof Error ? error.message : "Failed to join voice channel";
    dispatch({ type: VoiceActionType.SetConnectionError, payload: message });
    setRoom(null);
    throw error;
  }
}

export async function leaveVoiceChannel(deps: VoiceActionDeps) {
  const { dispatch, getVoiceState, getRoom, setRoom } = deps;
  const { currentChannelId } = getVoiceState();
  const room = getRoom();

  if (!currentChannelId || !room) {
    logger.warn('[Voice] leaveVoiceChannel: No channel or room', { currentChannelId, room: !!room });
    return;
  }

  logger.info('[Voice] === Leaving voice channel ===');
  logger.info('[Voice] Channel:', currentChannelId);

  try {
    // Notify backend before disconnecting (best-effort)
    try {
      await voicePresenceControllerLeavePresence({ path: { channelId: currentChannelId } });
      logger.info('[Voice] Removed voice presence via REST');
    } catch (err) {
      logger.warn('[Voice] Failed to remove voice presence (webhook will handle it):', err);
    }

    // Tear down the soundboard graph before disconnecting so the published
    // track/AudioContext don't leak across sessions. Dynamically imported —
    // this module isn't needed until an active room exists (see PR-11).
    const { soundboardPlayer } = await import("./soundboardPlayer");
    await soundboardPlayer.dispose(room).catch(() => {});

    logger.info('[Voice] Disconnecting from LiveKit room...');
    await room.disconnect();
    logger.info('[Voice] Disconnected from LiveKit');

    setRoom(null);
    dispatch({ type: VoiceActionType.SetDisconnected });
    clearConnectionState();
    setUpdateDeferred(false);

    playSound(Sounds.disconnected);
    logger.info('[Voice] === Voice channel leave complete ===');
  } catch (error) {
    logger.error('[Voice] Failed to leave voice channel:', error);
    const message = error instanceof Error ? error.message : "Failed to leave voice channel";
    dispatch({ type: VoiceActionType.SetConnectionError, payload: message });
    throw error;
  } finally {
    // Never leave a pending SW update suppressed after the call is over,
    // even when disconnect throws.
    setUpdateDeferred(false);
  }
}

// =============================================================================
// DM VOICE ACTIONS
// =============================================================================

interface JoinDmVoiceParams {
  dmGroupId: string;
  dmGroupName: string;
  user: { id: string; username: string; displayName?: string };
  connectionInfo: { url: string };
}

export async function joinDmVoice(
  params: JoinDmVoiceParams,
  deps: VoiceActionDeps
) {
  const { dmGroupId, dmGroupName, user, connectionInfo } = params;
  const { dispatch, setRoom } = deps;

  try {
    dispatch({ type: VoiceActionType.SetConnecting, payload: true });

    let tokenResponse;
    try {
      const { data } = await livekitControllerGenerateDmToken({
        body: { roomId: dmGroupId, identity: user.id, name: user.displayName || user.username },
        throwOnError: true,
      });
      tokenResponse = data;
    } catch (error) {
      if (error instanceof Error && (error.message.includes('401') || error.message.includes('Unauthorized'))) {
        logger.warn('[Voice] DM token may be stale, attempting refresh...');
        await refreshAuthToken();
        const { data } = await livekitControllerGenerateDmToken({
          body: { roomId: dmGroupId, identity: user.id, name: user.displayName || user.username },
          throwOnError: true,
        });
        tokenResponse = data;
      } else {
        throw error;
      }
    }

    await connectToLiveKitRoom(connectionInfo.url, tokenResponse.token, setRoom, dispatch);

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

    playSound(Sounds.connected);
  } catch (error) {
    logger.error("Failed to join DM voice call:", error);
    const message = error instanceof Error ? error.message : "Failed to join DM voice call";
    dispatch({ type: VoiceActionType.SetConnectionError, payload: message });
    setRoom(null);
    throw error;
  }
}

export async function leaveDmVoice(deps: VoiceActionDeps) {
  const { dispatch, getVoiceState, getRoom, setRoom } = deps;
  const { currentDmGroupId } = getVoiceState();
  const room = getRoom();

  if (!currentDmGroupId || !room) return;

  try {
    const { soundboardPlayer } = await import("./soundboardPlayer");
    await soundboardPlayer.dispose(room).catch(() => {});
    await room.disconnect();
    setRoom(null);
    dispatch({ type: VoiceActionType.SetDisconnected });
    clearConnectionState();
    setUpdateDeferred(false);
    playSound(Sounds.disconnected);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to leave DM voice call";
    dispatch({ type: VoiceActionType.SetConnectionError, payload: message });
    throw error;
  } finally {
    // Never leave a pending SW update suppressed after the call is over,
    // even when disconnect throws.
    setUpdateDeferred(false);
  }
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

      const resolutionConfig = getResolutionConfig(settings.resolution, settings.fps);
      const audioConfig = getScreenShareAudioConfig(settings.enableAudio !== false);

      logger.info('[Voice] Screen share audio config passed to LiveKit:', JSON.stringify(audioConfig));
      logger.info('[Voice] Screen share resolution config:', JSON.stringify(resolutionConfig));
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
        await room.localParticipant.setScreenShareEnabled(true, {
          audio: audioConfig,
          resolution: resolutionConfig as { width: number; height: number; frameRate: number },
          preferCurrentTab: false,
        });
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

          await room.localParticipant.setScreenShareEnabled(true, {
            audio: false,
            resolution: resolutionConfig as { width: number; height: number; frameRate: number },
            preferCurrentTab: false,
          });

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
