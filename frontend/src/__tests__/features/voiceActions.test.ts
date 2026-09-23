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
const roomEventHandlers: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('livekit-client', () => {
  class MockRoom {
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
  leaveVoiceChannel,
  toggleMicrophone,
  toggleDeafenUnified,
  switchAudioInputDevice,
  switchAudioOutputDevice,
} from '../../features/voice/voiceActions';
import { VoiceActionType, VoiceSessionType, type VoiceState } from '../../contexts/VoiceContext';
import { VideoLayoutMode } from '../../types/videoLayout';
import type { Room } from 'livekit-client';
import { livekitControllerGenerateToken, voicePresenceControllerJoinPresence, voicePresenceControllerLeavePresence, voicePresenceControllerUpdateDeafenState } from '../../api-client/sdk.gen';
import { getCachedItem } from '../../utils/storage';

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

      expect(voicePresenceControllerLeavePresence).toHaveBeenCalledWith({ path: { channelId: 'ch-1' } });
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
});
