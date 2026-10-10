import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before imports
const mockLocalParticipant = {
  setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
  setCameraEnabled: vi.fn().mockResolvedValue(undefined),
  setScreenShareEnabled: vi.fn().mockResolvedValue(undefined),
  setMetadata: vi.fn().mockResolvedValue(undefined),
  isMicrophoneEnabled: true,
  isCameraEnabled: false,
  isScreenShareEnabled: false,
  metadata: JSON.stringify({ isDeafened: false }),
  identity: 'user-1',
  getTrackPublication: vi.fn().mockReturnValue(null),
};

const mockRoomInstance = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  state: 'connected',
  localParticipant: mockLocalParticipant,
  switchActiveDevice: vi.fn().mockResolvedValue(undefined),
  getActiveDevice: vi.fn().mockReturnValue(undefined),
};

// Captures handlers registered via room.on() so tests can fire room events
const roomCtorArgs: unknown[] = [];
const roomEventHandlers: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('livekit-client', () => {
  class MockRoom {
    constructor(options?: unknown) {
      roomCtorArgs.push(options);
    }
    connect = mockRoomInstance.connect;
    disconnect = mockRoomInstance.disconnect;
    state = mockRoomInstance.state;
    localParticipant = mockRoomInstance.localParticipant;
    switchActiveDevice = mockRoomInstance.switchActiveDevice;
    getActiveDevice = mockRoomInstance.getActiveDevice;
    on = vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      roomEventHandlers[event] = handler;
      return this;
    });
  }
  return {
    Room: MockRoom,
    RoomEvent: {
      Reconnecting: 'reconnecting',
      Reconnected: 'reconnected',
      SignalConnected: 'signalConnected',
      Disconnected: 'disconnected',
      MediaDevicesChanged: 'mediaDevicesChanged',
      ActiveDeviceChanged: 'activeDeviceChanged',
      TrackMuted: 'trackMuted',
      TrackUnmuted: 'trackUnmuted',
      LocalTrackPublished: 'localTrackPublished',
      LocalTrackUnpublished: 'localTrackUnpublished',
    },
    DisconnectReason: {},
    VideoCaptureOptions: {},
    AudioCaptureOptions: {},
    // Referenced by utils/livekitWorkerTimers.ts (imported via voiceActions)
    CriticalTimers: {
      setTimeout: vi.fn(),
      setInterval: vi.fn(),
      clearTimeout: vi.fn(),
      clearInterval: vi.fn(),
    },
  };
});

vi.mock('../../api-client/sdk.gen', () => ({
  livekitControllerGenerateToken: vi.fn().mockResolvedValue({ data: { token: 'mock-token' } }),
  livekitControllerGenerateDmToken: vi.fn().mockResolvedValue({ data: { token: 'mock-dm-token' } }),
  voicePresenceControllerJoinPresence: vi.fn().mockResolvedValue(undefined),
  voicePresenceControllerLeavePresence: vi.fn().mockResolvedValue(undefined),
  voicePresenceControllerUpdateDeafenState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../main', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock('../../utils/storage', () => ({
  getCachedItem: vi.fn().mockReturnValue(null),
  setCachedItem: vi.fn(),
  removeCachedItem: vi.fn(),
}));

vi.mock('../../utils/screenShareState', () => ({
  getScreenShareSettings: vi.fn().mockReturnValue(null),
  DEFAULT_SCREEN_SHARE_SETTINGS: { resolution: '1080p', fps: 30, enableAudio: true },
}));

vi.mock('../../utils/screenShareResolution', () => ({
  getResolutionConfig: vi.fn().mockReturnValue({ width: 1920, height: 1080, frameRate: 30 }),
  getScreenShareAudioConfig: vi.fn().mockReturnValue(true),
}));

vi.mock('../../features/voice/screenSharePublish', () => ({
  publishScreenShare: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/platform', () => ({
  isElectron: vi.fn().mockReturnValue(false),
}));

vi.mock('../../hooks/useSound', () => ({
  playSound: vi.fn(),
  Sounds: {
    connected: 'connected',
    disconnected: 'disconnected',
    toggleOn: 'toggleOn',
    toggleOff: 'toggleOff',
    screenShareStarted: 'screenShareStarted',
    screenShareStopped: 'screenShareStopped',
    error: 'error',
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  joinVoiceChannel,
  joinDmVoice,
  leaveVoiceChannel,
  endVoiceSession,
  discardRoomForRejoin,
  getPendingJoin,
  LEAVE_REST_TIMEOUT_MS,
  MIC_ENABLE_TIMEOUT_MS,
  toggleMicrophone,
  toggleDeafenUnified,
  switchAudioInputDevice,
  switchAudioOutputDevice,
  toggleScreenShareUnified,
  getRoomOptions,
  canPublishMicrophone,
} from '../../features/voice/voiceActions';
import { VoiceActionType, VoiceEndReason, VoiceSessionType, type VoiceState } from '../../contexts/VoiceContext';
import { playSound } from '../../hooks/useSound';
import { setVoiceReconnectCanceller } from '../../features/voice/reconnectControl';
import { VideoLayoutMode } from '../../types/videoLayout';
import type { Room } from 'livekit-client';
import { livekitControllerGenerateToken, voicePresenceControllerJoinPresence, voicePresenceControllerLeavePresence, voicePresenceControllerUpdateDeafenState } from '../../api-client/sdk.gen';
import { getCachedItem, setCachedItem } from '../../utils/storage';
import { publishScreenShare } from '../../features/voice/screenSharePublish';
import { getScreenShareSettings, DEFAULT_SCREEN_SHARE_SETTINGS } from '../../utils/screenShareState';
import { getScreenShareAudioConfig } from '../../utils/screenShareResolution';
import { getMicPublishDefaults } from '../../utils/voiceQuality';

function createMockDeps(overrides: Partial<{
  channelId: string | null;
  dmGroupId: string | null;
  isDeafened: boolean;
  isServerMuted: boolean;
  wasMutedBeforeDeafen: boolean;
  room: unknown;
}> = {}) {
  const dispatch = vi.fn();
  const hasRoomOverride = 'room' in overrides;
  const room = hasRoomOverride ? overrides.room : mockRoomInstance;
  return {
    dispatch,
    getVoiceState: (): VoiceState => ({
      isConnected: true,
      isConnecting: false,
      connectionError: null,
      contextType: VoiceSessionType.Channel,
      currentChannelId: 'channelId' in overrides ? (overrides.channelId ?? null) : 'ch-1',
      channelName: 'General',
      communityId: 'c1',
      isPrivate: false,
      createdAt: '2025-01-01',
      currentDmGroupId: 'dmGroupId' in overrides ? (overrides.dmGroupId ?? null) : null,
      dmGroupName: null,
      isDeafened: overrides.isDeafened ?? false,
      isServerMuted: overrides.isServerMuted ?? false,
      showVideoTiles: false,
      pipCollapsed: false,
      screenShareAudioFailed: false,
      selectedAudioInputId: null,
      selectedAudioOutputId: null,
      selectedVideoInputId: null,
      wasMutedBeforeDeafen: overrides.wasMutedBeforeDeafen ?? false,
      watchingCameras: new Set<string>(),
      watchingScreenShares: new Set<string>(),
      hiddenLocalTiles: new Set<string>(),
      stageMounted: false,
      layoutMode: VideoLayoutMode.Grid,
      pinnedTileId: null,
      spotlightTileId: null,
      reconnect: null,
      lastEnded: null,
    }),
    getRoom: () => room as Room | null,
    setRoom: vi.fn(),
  };
}

describe('voiceActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoomInstance.localParticipant.isMicrophoneEnabled = true;
    mockRoomInstance.localParticipant.metadata = JSON.stringify({ isDeafened: false });
    mockRoomInstance.getActiveDevice.mockReturnValue(undefined);
    Object.keys(roomEventHandlers).forEach((key) => delete roomEventHandlers[key]);
    roomCtorArgs.length = 0;
    vi.mocked(getCachedItem).mockReturnValue(null);
    vi.mocked(getScreenShareSettings).mockReturnValue(undefined);
    vi.mocked(publishScreenShare).mockResolvedValue(undefined);
    mockLocalParticipant.isScreenShareEnabled = false;
  });

  describe('joinVoiceChannel', () => {
    const params = {
      channelId: 'ch-1',
      channelName: 'General',
      communityId: 'c1',
      isPrivate: false,
      createdAt: '2025-01-01',
      user: { id: 'user-1', username: 'testuser', displayName: 'Test User' },
      connectionInfo: { url: 'ws://localhost:7880' },
    };

    it('dispatches SET_CONNECTING then SET_CONNECTED on success', async () => {
      const deps = createMockDeps();
      await joinVoiceChannel(params, deps);

      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetConnecting, payload: true });
      expect(deps.dispatch).toHaveBeenCalledWith({
        type: VoiceActionType.SetConnected,
        payload: { channelId: 'ch-1', channelName: 'General', communityId: 'c1', isPrivate: false, createdAt: '2025-01-01' },
      });
    });

    it('enables the microphone on a normal join', async () => {
      const deps = createMockDeps();
      await joinVoiceChannel(params, deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true, expect.anything());
    });

    it('startMuted ("Join muted" / listen-only) keeps the microphone off', async () => {
      const deps = createMockDeps();
      await joinVoiceChannel({ ...params, startMuted: true }, deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true, expect.anything());
      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
      expect(deps.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: VoiceActionType.SetConnected }));
    });

    describe('mic permission from the token (listen-only joins from anywhere)', () => {
      const withPermissions = (permissions: unknown) => {
        (mockLocalParticipant as Record<string, unknown>).permissions = permissions;
      };
      beforeEach(() => withPermissions(undefined));

      it('skips enabling the mic when the token cannot publish at all', async () => {
        withPermissions({ canPublish: false, canPublishSources: [] });
        await joinVoiceChannel(params, createMockDeps());
        expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true, expect.anything());
        withPermissions(undefined);
      });

      it('skips enabling the mic when the allowed sources lack MICROPHONE', async () => {
        withPermissions({ canPublish: true, canPublishSources: [1, 3, 4] });
        await joinVoiceChannel(params, createMockDeps());
        expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true, expect.anything());
        withPermissions(undefined);
      });

      it('enables the mic when MICROPHONE is allowed', async () => {
        withPermissions({ canPublish: true, canPublishSources: [2] });
        await joinVoiceChannel(params, createMockDeps());
        expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true, expect.anything());
        withPermissions(undefined);
      });
    });

    describe('saved mic state for a recovery rejoin', () => {
      const savedCall = () =>
        vi.mocked(setCachedItem).mock.calls.filter(([key]) => key === 'semaphore_voice_connection').slice(-1)[0]?.[1] as
          | { micMuted?: boolean }
          | undefined;

      it('saves micMuted with the connection', async () => {
        await joinVoiceChannel(params, createMockDeps());
        expect(savedCall()).toMatchObject({ channelId: 'ch-1', micMuted: false });
      });

      it('updates the saved micMuted when the local mic is muted later', async () => {
        await joinVoiceChannel(params, createMockDeps());
        vi.mocked(getCachedItem).mockImplementation((key: string) =>
          key === 'semaphore_voice_connection' ? { contextType: 'channel', channelId: 'ch-1', micMuted: false, timestamp: 1 } : null,
        );
        mockRoomInstance.localParticipant.isMicrophoneEnabled = false;
        roomEventHandlers['trackMuted']();
        expect(savedCall()).toMatchObject({ micMuted: true, timestamp: 1 });
      });
    });

    it('requests a token and connects to the room', async () => {
      const deps = createMockDeps();
      await joinVoiceChannel(params, deps);

      expect(livekitControllerGenerateToken).toHaveBeenCalledWith({
        body: { roomId: 'ch-1', identity: 'user-1', name: 'Test User' },
        throwOnError: true,
      });
      // autoSubscribe: false must be passed to connect() (RoomConnectOptions),
      // NOT the Room constructor — passing it to the constructor was a silent
      // no-op for the product's entire life (#365).
      expect(mockRoomInstance.connect).toHaveBeenCalledWith('ws://localhost:7880', 'mock-token', {
        autoSubscribe: false,
      });
    });

    it('calls voicePresenceControllerJoinPresence', async () => {
      const deps = createMockDeps();
      await joinVoiceChannel(params, deps);

      expect(voicePresenceControllerJoinPresence).toHaveBeenCalledWith({ path: { channelId: 'ch-1' } });
    });

    it('dispatches SET_CONNECTION_ERROR on token failure', async () => {
      vi.mocked(livekitControllerGenerateToken).mockRejectedValueOnce(new Error('Token failed'));
      const deps = createMockDeps();

      await expect(joinVoiceChannel(params, deps)).rejects.toThrow('Token failed');
      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetConnectionError, payload: 'Token failed' });
    });

    it('calls setRoom(null) on failure', async () => {
      vi.mocked(livekitControllerGenerateToken).mockRejectedValueOnce(new Error('fail'));
      const deps = createMockDeps();

      await expect(joinVoiceChannel(params, deps)).rejects.toThrow();
      expect(deps.setRoom).toHaveBeenCalledWith(null);
    });

    it('applies "default" device preference on connect', async () => {
      vi.mocked(getCachedItem).mockReturnValue({
        audioInputDeviceId: 'default',
        audioOutputDeviceId: 'default',
        videoInputDeviceId: 'default',
      });
      // Mock navigator.mediaDevices.enumerateDevices
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          enumerateDevices: vi.fn().mockResolvedValue([
            { deviceId: 'default', kind: 'audioinput', label: 'Default', groupId: '1' },
            { deviceId: 'default', kind: 'audiooutput', label: 'Default', groupId: '1' },
          ]),
        },
        configurable: true,
      });

      const deps = createMockDeps();
      await joinVoiceChannel(params, deps);

      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'default');
      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'default');
    });

    it('applies explicit device preference on connect', async () => {
      vi.mocked(getCachedItem).mockReturnValue({
        audioInputDeviceId: 'mic-123',
        audioOutputDeviceId: 'speaker-456',
        videoInputDeviceId: 'default',
      });
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          enumerateDevices: vi.fn().mockResolvedValue([
            { deviceId: 'mic-123', kind: 'audioinput', label: 'USB Mic', groupId: '1' },
            { deviceId: 'speaker-456', kind: 'audiooutput', label: 'USB Speaker', groupId: '2' },
          ]),
        },
        configurable: true,
      });

      const deps = createMockDeps();
      await joinVoiceChannel(params, deps);

      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'mic-123');
      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'speaker-456');
    });
  });

  describe('leaveVoiceChannel', () => {
    it('disconnects room and dispatches SET_DISCONNECTED', async () => {
      const deps = createMockDeps();
      await leaveVoiceChannel(deps);

      expect(mockRoomInstance.disconnect).toHaveBeenCalled();
      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetDisconnected });
    });

    it('calls voicePresenceControllerLeavePresence', async () => {
      const deps = createMockDeps();
      await leaveVoiceChannel(deps);

      expect(voicePresenceControllerLeavePresence).toHaveBeenCalledWith({
        path: { channelId: 'ch-1' },
        signal: expect.any(AbortSignal),
      });
    });

    it('returns early when no channel or room', async () => {
      const deps = createMockDeps({ channelId: null, room: null });
      await leaveVoiceChannel(deps);

      expect(deps.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('toggleMicrophone', () => {
    it('disables mic when currently enabled (no audio options)', async () => {
      mockRoomInstance.localParticipant.isMicrophoneEnabled = true;
      const deps = createMockDeps();
      await toggleMicrophone(deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false, undefined);
    });

    it('enables mic when currently disabled with audio capture options', async () => {
      mockRoomInstance.localParticipant.isMicrophoneEnabled = false;
      const deps = createMockDeps();
      await toggleMicrophone(deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          voiceIsolation: false,
        }),
      );
    });

    it('returns early when no room', async () => {
      const deps = createMockDeps({ room: null });
      await toggleMicrophone(deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    });

    it('blocks unmute when server-muted', async () => {
      mockRoomInstance.localParticipant.isMicrophoneEnabled = false;
      const deps = createMockDeps({ isServerMuted: true });
      await toggleMicrophone(deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    });

    it('allows mute (self-mute) when server-muted and mic is on', async () => {
      // User is server-muted but mic is still enabled — they should be able to self-mute
      mockRoomInstance.localParticipant.isMicrophoneEnabled = true;
      const deps = createMockDeps({ isServerMuted: true });
      await toggleMicrophone(deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false, undefined);
    });
  });

  describe('toggleDeafenUnified', () => {
    it('dispatches SET_DEAFENED and updates metadata', async () => {
      const deps = createMockDeps({ isDeafened: false });
      await toggleDeafenUnified(deps);

      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetDeafened, payload: true });
      expect(mockRoomInstance.localParticipant.setMetadata).toHaveBeenCalled();
    });

    it('mutes mic when deafening if mic was enabled', async () => {
      mockRoomInstance.localParticipant.isMicrophoneEnabled = true;
      const deps = createMockDeps({ isDeafened: false });
      await toggleDeafenUnified(deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    });

    it('calls voicePresenceControllerUpdateDeafenState when in a channel', async () => {
      const deps = createMockDeps({ isDeafened: false });
      await toggleDeafenUnified(deps);

      expect(voicePresenceControllerUpdateDeafenState).toHaveBeenCalledWith({
        path: { channelId: 'ch-1' },
        body: { isDeafened: true },
      });
    });

    it('does not call deafen API when in DM (no channelId)', async () => {
      const deps = createMockDeps({ isDeafened: false, channelId: null, dmGroupId: 'dm-1' });
      await toggleDeafenUnified(deps);

      expect(voicePresenceControllerUpdateDeafenState).not.toHaveBeenCalled();
    });

    it('rolls back deafen state on error', async () => {
      mockRoomInstance.localParticipant.setMetadata.mockRejectedValueOnce(new Error('fail'));
      const deps = createMockDeps({ isDeafened: false });

      await expect(toggleDeafenUnified(deps)).rejects.toThrow('fail');
      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetDeafened, payload: false });
    });

    it('does not restore mic when undeafening if server-muted', async () => {
      mockRoomInstance.localParticipant.isMicrophoneEnabled = false;
      const deps = createMockDeps({ isDeafened: true, isServerMuted: true, wasMutedBeforeDeafen: false });
      await toggleDeafenUnified(deps);

      // Should undeafen but NOT re-enable mic because server-muted
      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetDeafened, payload: false });
      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    });
  });

  describe('switchAudioInputDevice', () => {
    it('calls room.switchActiveDevice and dispatches', async () => {
      const deps = createMockDeps();
      await switchAudioInputDevice('device-123', deps);

      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'device-123');
      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetSelectedAudioInputId, payload: 'device-123' });
    });

    it('returns early when no room', async () => {
      const deps = createMockDeps({ room: null });
      await switchAudioInputDevice('device-123', deps);

      expect(mockRoomInstance.switchActiveDevice).not.toHaveBeenCalled();
    });
  });

  describe('switchAudioOutputDevice', () => {
    it('calls room.switchActiveDevice and dispatches', async () => {
      const deps = createMockDeps();
      await switchAudioOutputDevice('device-456', deps);

      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'device-456');
      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetSelectedAudioOutputId, payload: 'device-456' });
    });

    it('returns early when no room or channel', async () => {
      const deps = createMockDeps({ channelId: null, dmGroupId: null });
      await switchAudioOutputDevice('device-456', deps);

      expect(mockRoomInstance.switchActiveDevice).not.toHaveBeenCalled();
    });
  });

  describe('device change handling (#346)', () => {
    const params = {
      channelId: 'ch-1',
      channelName: 'General',
      communityId: 'c1',
      isPrivate: false,
      createdAt: '2025-01-01',
      user: { id: 'user-1', username: 'testuser', displayName: 'Test User' },
      connectionInfo: { url: 'ws://localhost:7880' },
    };

    const setDeviceList = (devices: { deviceId: string; kind: string; label: string; groupId: string }[]) => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { enumerateDevices: vi.fn().mockResolvedValue(devices) },
        configurable: true,
      });
    };

    const mockDevicePrefs = (prefs: { audioInputDeviceId: string; audioOutputDeviceId: string; videoInputDeviceId: string } | null) => {
      vi.mocked(getCachedItem).mockImplementation((key: string) =>
        key === 'semaphore_device_preferences' ? prefs : null
      );
    };

    const defaultMic = { deviceId: 'default', kind: 'audioinput', label: 'Default Mic', groupId: 'g1' };
    const usbMic = { deviceId: 'mic-123', kind: 'audioinput', label: 'USB Mic', groupId: 'g2' };
    const defaultSpeaker = { deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker', groupId: 'g1' };

    it('binds audio to the default pseudo-device on join when no preferences saved', async () => {
      mockDevicePrefs(null);
      setDeviceList([defaultMic, usbMic, defaultSpeaker]);

      await joinVoiceChannel(params, createMockDeps());

      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'default');
      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'default');
    });

    it('skips default binding when the browser has no default pseudo-device', async () => {
      mockDevicePrefs(null);
      setDeviceList([
        { deviceId: 'mic-ff', kind: 'audioinput', label: 'Mic', groupId: 'g1' },
        { deviceId: 'spk-ff', kind: 'audiooutput', label: 'Speaker', groupId: 'g1' },
      ]);

      await joinVoiceChannel(params, createMockDeps());

      expect(mockRoomInstance.switchActiveDevice).not.toHaveBeenCalled();
    });

    it('dispatches selected-device updates when LiveKit reports an active device change', async () => {
      mockDevicePrefs(null);
      setDeviceList([]);
      const deps = createMockDeps();
      await joinVoiceChannel(params, deps);

      roomEventHandlers['activeDeviceChanged']('audioinput', 'mic-new');
      roomEventHandlers['activeDeviceChanged']('audiooutput', 'spk-new');

      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetSelectedAudioInputId, payload: 'mic-new' });
      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetSelectedAudioOutputId, payload: 'spk-new' });
    });

    it('falls back to the default device when the active mic is unplugged', async () => {
      mockDevicePrefs({ audioInputDeviceId: 'mic-123', audioOutputDeviceId: 'default', videoInputDeviceId: 'default' });
      setDeviceList([defaultMic, usbMic, defaultSpeaker]);
      const deps = createMockDeps();
      await joinVoiceChannel(params, deps);
      mockRoomInstance.switchActiveDevice.mockClear();

      mockRoomInstance.getActiveDevice.mockImplementation((kind: string) =>
        kind === 'audioinput' ? 'mic-123' : 'default'
      );
      setDeviceList([defaultMic, defaultSpeaker]); // USB mic unplugged
      await roomEventHandlers['mediaDevicesChanged']();

      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledTimes(1);
      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'default');
      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetSelectedAudioInputId, payload: 'default' });
    });

    it('switches back to the preferred mic when it is reconnected', async () => {
      mockDevicePrefs({ audioInputDeviceId: 'mic-123', audioOutputDeviceId: 'default', videoInputDeviceId: 'default' });
      setDeviceList([defaultMic, defaultSpeaker]); // preferred mic missing at join
      const deps = createMockDeps();
      await joinVoiceChannel(params, deps);
      mockRoomInstance.switchActiveDevice.mockClear();

      mockRoomInstance.getActiveDevice.mockReturnValue('default');
      setDeviceList([defaultMic, usbMic, defaultSpeaker]); // USB mic plugged back in
      await roomEventHandlers['mediaDevicesChanged']();

      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledTimes(1);
      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'mic-123');
      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetSelectedAudioInputId, payload: 'mic-123' });
    });

    it('does nothing on device change when the room is disconnected', async () => {
      mockDevicePrefs(null);
      setDeviceList([]);
      const deps = createMockDeps();
      await joinVoiceChannel(params, deps);
      const room = deps.setRoom.mock.calls[0][0] as { state: string };
      room.state = 'disconnected';
      mockRoomInstance.switchActiveDevice.mockClear();

      mockRoomInstance.getActiveDevice.mockReturnValue('mic-123');
      setDeviceList([defaultMic, defaultSpeaker]);
      await roomEventHandlers['mediaDevicesChanged']();

      expect(mockRoomInstance.switchActiveDevice).not.toHaveBeenCalled();
    });
  });

  describe('audio capture options', () => {
    it('reads custom audio processing settings from localStorage', async () => {
      vi.mocked(getCachedItem).mockImplementation((key: string) => {
        if (key === 'semaphore_voice_settings') {
          return {
            inputMode: 'voice_activity',
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            voiceIsolation: true,
          };
        }
        return null;
      });

      mockRoomInstance.localParticipant.isMicrophoneEnabled = false;
      const deps = createMockDeps();
      await toggleMicrophone(deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          voiceIsolation: true,
        }),
      );
    });

    it('uses defaults when no voice settings saved', async () => {
      vi.mocked(getCachedItem).mockReturnValue(null);

      mockRoomInstance.localParticipant.isMicrophoneEnabled = false;
      const deps = createMockDeps();
      await toggleMicrophone(deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          voiceIsolation: false,
        }),
      );
    });

    it('passes audio options when undeafening restores mic', async () => {
      vi.mocked(getCachedItem).mockReturnValue(null);
      mockRoomInstance.localParticipant.isMicrophoneEnabled = false;

      const deps = createMockDeps({ isDeafened: true, wasMutedBeforeDeafen: false, isServerMuted: false });
      await toggleDeafenUnified(deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          voiceIsolation: false,
        }),
      );
    });

    it('passes audio options when joining a voice channel in voice activity mode', async () => {
      vi.mocked(getCachedItem).mockImplementation((key: string) => {
        if (key === 'semaphore_voice_settings') {
          return { inputMode: 'voice_activity', echoCancellation: false, voiceIsolation: true };
        }
        return null;
      });

      Object.defineProperty(navigator, 'mediaDevices', {
        value: { enumerateDevices: vi.fn().mockResolvedValue([]) },
        configurable: true,
      });

      const deps = createMockDeps();
      const params = {
        channelId: 'ch-1',
        channelName: 'General',
        communityId: 'c1',
        isPrivate: false,
        createdAt: '2025-01-01',
        user: { id: 'user-1', username: 'testuser', displayName: 'Test User' },
        connectionInfo: { url: 'ws://localhost:7880' },
      };
      await joinVoiceChannel(params, deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          echoCancellation: false,
          voiceIsolation: true,
        }),
      );
    });
  });
  describe('room options', () => {
    const joinParams = {
      channelId: 'ch-1',
      channelName: 'General',
      communityId: 'c1',
      isPrivate: false,
      createdAt: '2025-01-01',
      user: { id: 'user-1', username: 'testuser', displayName: 'Test User' },
      connectionInfo: { url: 'ws://localhost:7880' },
    };

    it('getRoomOptions enables adaptiveStream and dynacast with default mic quality', () => {
      expect(getRoomOptions()).toEqual({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: getMicPublishDefaults('high'),
      });
    });

    it('joining constructs the Room with default mic publish defaults', async () => {
      await joinVoiceChannel(joinParams, createMockDeps());
      expect(roomCtorArgs).toHaveLength(1);
      expect(roomCtorArgs[0]).toMatchObject({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { audioPreset: { maxBitrate: 96000 }, dtx: true },
      });
    });

    it('joining uses the stored music mic quality', async () => {
      vi.mocked(getCachedItem).mockImplementation((key: string) =>
        key === 'semaphore_voice_settings' ? { micQuality: 'music' } : null,
      );
      await joinVoiceChannel(joinParams, createMockDeps());
      expect(roomCtorArgs[0]).toMatchObject({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { audioPreset: { maxBitrate: 128000 }, dtx: false },
      });
      expect(getRoomOptions().publishDefaults).toEqual(getMicPublishDefaults('music'));
    });
  });

  describe('toggleScreenShareUnified', () => {
    it('publishes via publishScreenShare with default settings and audio config', async () => {
      vi.mocked(getScreenShareAudioConfig).mockReturnValue(true as unknown as ReturnType<typeof getScreenShareAudioConfig>);
      const deps = createMockDeps();
      await toggleScreenShareUnified(deps);

      expect(publishScreenShare).toHaveBeenCalledWith(mockRoomInstance, DEFAULT_SCREEN_SHARE_SETTINGS, true);
      expect(mockLocalParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
    });

    it('uses stored settings when present', async () => {
      const stored = { resolution: '4k', fps: 60, enableAudio: false };
      vi.mocked(getScreenShareSettings).mockReturnValue(stored as never);
      vi.mocked(getScreenShareAudioConfig).mockReturnValue(false);
      await toggleScreenShareUnified(createMockDeps());

      expect(getScreenShareAudioConfig).toHaveBeenCalledWith(false);
      expect(publishScreenShare).toHaveBeenCalledWith(mockRoomInstance, stored, false);
    });

    it('retries without audio on NotReadableError and flags the failure', async () => {
      const err = Object.assign(new Error('Could not start audio source'), { name: 'NotReadableError' });
      vi.mocked(publishScreenShare).mockRejectedValueOnce(err);
      const deps = createMockDeps();
      await toggleScreenShareUnified(deps);

      expect(publishScreenShare).toHaveBeenCalledTimes(2);
      expect(publishScreenShare).toHaveBeenLastCalledWith(mockRoomInstance, DEFAULT_SCREEN_SHARE_SETTINGS, false);
      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetScreenShareAudioFailed, payload: true });
    });

    it('rethrows other publish errors', async () => {
      vi.mocked(publishScreenShare).mockRejectedValueOnce(new Error('boom'));
      await expect(toggleScreenShareUnified(createMockDeps())).rejects.toThrow('boom');
      expect(publishScreenShare).toHaveBeenCalledTimes(1);
    });

    it('stops sharing with setScreenShareEnabled(false) when already sharing', async () => {
      mockLocalParticipant.isScreenShareEnabled = true;
      await toggleScreenShareUnified(createMockDeps());

      expect(mockLocalParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
      expect(publishScreenShare).not.toHaveBeenCalled();
    });
  });
});

describe('voiceActions resilience (#309)', () => {
  const params = {
    channelId: 'ch-1',
    channelName: 'General',
    communityId: 'c1',
    isPrivate: false,
    createdAt: '2025-01-01',
    user: { id: 'user-1', username: 'testuser', displayName: 'Test User' },
    connectionInfo: { url: 'ws://localhost:7880' },
  };

  /** Deps whose voice state is "connecting" (nothing joined yet). */
  function connectingDeps() {
    const deps = createMockDeps({ channelId: null, room: null });
    const base = deps.getVoiceState();
    return { ...deps, getVoiceState: () => ({ ...base, isConnected: false, isConnecting: true }) };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRoomInstance.connect.mockResolvedValue(undefined);
    mockRoomInstance.disconnect.mockResolvedValue(undefined);
    mockLocalParticipant.setMicrophoneEnabled.mockResolvedValue(undefined);
    mockLocalParticipant.isMicrophoneEnabled = true;
    vi.mocked(getCachedItem).mockReturnValue(null);
    vi.mocked(voicePresenceControllerLeavePresence).mockResolvedValue(undefined as never);
  });

  describe('leave', () => {
    it('updates the UI and disconnects LiveKit without waiting for the REST leave', async () => {
      // A REST leave that never answers (dead network)
      vi.mocked(voicePresenceControllerLeavePresence).mockReturnValue(new Promise(() => {}) as never);
      const deps = createMockDeps();

      await leaveVoiceChannel(deps);

      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetDisconnected });
      expect(deps.setRoom).toHaveBeenCalledWith(null);
      expect(mockRoomInstance.disconnect).toHaveBeenCalled();
      expect(playSound).toHaveBeenCalledWith('disconnected');
    });

    it('aborts the REST leave after the timeout', async () => {
      vi.useFakeTimers();
      try {
        let signal: AbortSignal | undefined;
        vi.mocked(voicePresenceControllerLeavePresence).mockImplementation(((opts: { signal: AbortSignal }) => {
          signal = opts.signal;
          return new Promise(() => {});
        }) as never);

        await leaveVoiceChannel(createMockDeps());
        expect(signal?.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(LEAVE_REST_TIMEOUT_MS - 1);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(signal?.aborted).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('updates the UI before LiveKit finishes disconnecting', async () => {
      let finishDisconnect: () => void = () => {};
      mockRoomInstance.disconnect.mockReturnValueOnce(new Promise<void>((resolve) => { finishDisconnect = resolve; }));
      const deps = createMockDeps();

      const leaving = leaveVoiceChannel(deps);
      await vi.waitFor(() => expect(mockRoomInstance.disconnect).toHaveBeenCalled());
      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetDisconnected });

      finishDisconnect();
      await leaving;
    });

    it('cancels a running rejoin loop', async () => {
      const cancel = vi.fn();
      setVoiceReconnectCanceller(cancel);

      await leaveVoiceChannel(createMockDeps());

      expect(cancel).toHaveBeenCalled();
    });
  });

  describe('cancellable join', () => {
    it('leave during "Connecting…" cancels the join', async () => {
      let rejectConnect: (e: Error) => void = () => {};
      mockRoomInstance.connect.mockReturnValueOnce(
        new Promise<void>((_, reject) => { rejectConnect = reject; }),
      );
      // room.disconnect() aborts room.connect()
      mockRoomInstance.disconnect.mockImplementationOnce(async () => {
        rejectConnect(new Error('Client initiated disconnect'));
      });
      const deps = connectingDeps();

      const joining = joinVoiceChannel(params, deps);
      await vi.waitFor(() => expect(mockRoomInstance.connect).toHaveBeenCalled());
      expect(getPendingJoin()).not.toBeNull();

      await leaveVoiceChannel(deps);
      await expect(joining).resolves.toBeUndefined();

      expect(mockRoomInstance.disconnect).toHaveBeenCalled();
      expect(deps.dispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetDisconnected });
      const types = deps.dispatch.mock.calls.map(([a]) => a.type);
      expect(types).not.toContain(VoiceActionType.SetConnected);
      expect(types).not.toContain(VoiceActionType.SetConnectionError);
      expect(voicePresenceControllerJoinPresence).not.toHaveBeenCalled();
      // Nothing was joined, so nothing to leave on the server and no hang-up sound
      expect(voicePresenceControllerLeavePresence).not.toHaveBeenCalled();
      expect(playSound).not.toHaveBeenCalled();
      expect(getPendingJoin()).toBeNull();
    });

    it('leave while the token is being fetched cancels before connecting', async () => {
      let resolveToken: (v: unknown) => void = () => {};
      vi.mocked(livekitControllerGenerateToken).mockReturnValueOnce(
        new Promise((resolve) => { resolveToken = resolve; }) as never,
      );
      const deps = connectingDeps();

      const joining = joinVoiceChannel(params, deps);
      await leaveVoiceChannel(deps);
      resolveToken({ data: { token: 'mock-token' } });
      await joining;

      expect(mockRoomInstance.connect).not.toHaveBeenCalled();
      expect(deps.dispatch.mock.calls.map(([a]) => a.type)).not.toContain(VoiceActionType.SetConnected);
    });

    it('ignores a second join while one is pending (double-click)', async () => {
      let resolveToken: (v: unknown) => void = () => {};
      vi.mocked(livekitControllerGenerateToken).mockReturnValueOnce(
        new Promise((resolve) => { resolveToken = resolve; }) as never,
      );
      const deps = connectingDeps();

      const first = joinVoiceChannel(params, deps);
      const second = joinVoiceChannel(params, deps);
      await second;
      expect(livekitControllerGenerateToken).toHaveBeenCalledTimes(1);

      resolveToken({ data: { token: 'mock-token' } });
      await first;
      expect(mockRoomInstance.connect).toHaveBeenCalledTimes(1);
      expect(getPendingJoin()).toBeNull();
    });

    it('a DM join is guarded the same way', async () => {
      let resolveToken: (v: unknown) => void = () => {};
      const { livekitControllerGenerateDmToken } = await import('../../api-client/sdk.gen');
      vi.mocked(livekitControllerGenerateDmToken).mockReturnValueOnce(
        new Promise((resolve) => { resolveToken = resolve; }) as never,
      );
      const deps = connectingDeps();
      const dmParams = { dmGroupId: 'dm-1', dmGroupName: 'DM', user: params.user, connectionInfo: params.connectionInfo };

      const first = joinDmVoice(dmParams, deps);
      await joinDmVoice(dmParams, deps);
      expect(livekitControllerGenerateDmToken).toHaveBeenCalledTimes(1);

      resolveToken({ data: { token: 'mock-dm-token' } });
      await first;
    });
  });

  describe('quiet rejoin', () => {
    it('dropping the dead room skips the REST leave, sounds and state reset', async () => {
      const deps = createMockDeps();

      await discardRoomForRejoin(deps);

      expect(mockRoomInstance.disconnect).toHaveBeenCalled();
      expect(deps.setRoom).toHaveBeenCalledWith(null);
      expect(voicePresenceControllerLeavePresence).not.toHaveBeenCalled();
      expect(playSound).not.toHaveBeenCalled();
      expect(deps.dispatch).not.toHaveBeenCalled();
    });

    it('a quiet join plays no connect sound', async () => {
      const deps = createMockDeps();

      await joinVoiceChannel({ ...params, quiet: true }, deps);

      expect(deps.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: VoiceActionType.SetConnected }));
      expect(playSound).not.toHaveBeenCalled();
    });

    it('a normal join plays the connect sound', async () => {
      await joinVoiceChannel(params, createMockDeps());
      expect(playSound).toHaveBeenCalledWith('connected');
    });

    it('a DM rejoin keeps the mic muted', async () => {
      const deps = createMockDeps();
      await joinDmVoice(
        { dmGroupId: 'dm-1', dmGroupName: 'DM', user: params.user, connectionInfo: params.connectionInfo, startMuted: true, quiet: true },
        deps,
      );
      expect(mockLocalParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
      expect(mockLocalParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true, expect.anything());
    });
  });

  describe('endVoiceSession', () => {
    it('ends the call with the reason and no REST leave', async () => {
      const deps = createMockDeps();

      await endVoiceSession(VoiceEndReason.DuplicateIdentity, deps);

      expect(deps.dispatch).toHaveBeenCalledWith({
        type: VoiceActionType.SetDisconnected,
        payload: { reason: VoiceEndReason.DuplicateIdentity, error: null },
      });
      expect(deps.setRoom).toHaveBeenCalledWith(null);
      expect(mockRoomInstance.disconnect).toHaveBeenCalled();
      expect(voicePresenceControllerLeavePresence).not.toHaveBeenCalled();
    });
  });

  describe('mic enable timeout', () => {
    it('turns the mic off again when the enable succeeds after the timeout', async () => {
      vi.useFakeTimers();
      try {
        let resolveMic: () => void = () => {};
        mockLocalParticipant.setMicrophoneEnabled.mockImplementationOnce(
          () => new Promise<void>((resolve) => { resolveMic = resolve; }),
        );
        const deps = createMockDeps();

        const joining = joinVoiceChannel(params, deps);
        await vi.advanceTimersByTimeAsync(MIC_ENABLE_TIMEOUT_MS);
        await joining;
        expect(mockLocalParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);

        // The enable lands late: the user was told they joined muted
        mockLocalParticipant.isMicrophoneEnabled = true;
        resolveMic();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockLocalParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('leaves the mic on when the user unmuted after the timeout', async () => {
      vi.useFakeTimers();
      try {
        let resolveMic: () => void = () => {};
        mockLocalParticipant.setMicrophoneEnabled.mockImplementationOnce(
          () => new Promise<void>((resolve) => { resolveMic = resolve; }),
        );
        mockLocalParticipant.isMicrophoneEnabled = false;
        let joinedRoom: Room | null = null;
        const deps = { ...createMockDeps(), setRoom: vi.fn((r: Room | null) => { if (r) joinedRoom = r; }) };

        const joining = joinVoiceChannel(params, deps);
        await vi.advanceTimersByTimeAsync(MIC_ENABLE_TIMEOUT_MS);
        await joining;

        // The user unmutes on purpose
        await toggleMicrophone({ ...createMockDeps(), getRoom: () => joinedRoom });
        const callsAfterUnmute = mockLocalParticipant.setMicrophoneEnabled.mock.calls.length;

        mockLocalParticipant.isMicrophoneEnabled = true;
        resolveMic();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockLocalParticipant.setMicrophoneEnabled.mock.calls.length).toBe(callsAfterUnmute);
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears the timeout when the mic enables in time', async () => {
      vi.useFakeTimers();
      try {
        await joinVoiceChannel(params, createMockDeps());
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('canPublishMicrophone', () => {
  it.each([
    [undefined, true],
    [{ canPublish: true }, true],
    [{ canPublish: true, canPublishSources: [] }, true],
    [{ canPublish: true, canPublishSources: [2] }, true],
    [{ canPublish: false }, false],
    [{ canPublish: true, canPublishSources: [1] }, false],
  ])('%o → %s', (permissions, expected) => {
    expect(canPublishMicrophone(permissions)).toBe(expected);
  });
});
