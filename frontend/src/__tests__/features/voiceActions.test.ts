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
};

vi.mock('livekit-client', () => {
  class MockRoom {
    connect = mockRoomInstance.connect;
    disconnect = mockRoomInstance.disconnect;
    state = mockRoomInstance.state;
    localParticipant = mockRoomInstance.localParticipant;
    switchActiveDevice = mockRoomInstance.switchActiveDevice;
  }
  return {
    Room: MockRoom,
    VideoCaptureOptions: {},
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
    getVoiceState: () => ({
      isConnected: true,
      isConnecting: false,
      connectionError: null,
      contextType: 'channel' as const,
      currentChannelId: 'channelId' in overrides ? overrides.channelId : 'ch-1',
      channelName: 'General',
      communityId: 'c1',
      isPrivate: false,
      createdAt: '2025-01-01',
      currentDmGroupId: 'dmGroupId' in overrides ? overrides.dmGroupId : null,
      dmGroupName: null,
      isDeafened: overrides.isDeafened ?? false,
      isServerMuted: overrides.isServerMuted ?? false,
      showVideoTiles: false,
      screenShareAudioFailed: false,
      requestMaximize: false,
      selectedAudioInputId: null,
      selectedAudioOutputId: null,
      selectedVideoInputId: null,
      wasMutedBeforeDeafen: overrides.wasMutedBeforeDeafen ?? false,
    }),
    getRoom: () => room as never,
    setRoom: vi.fn(),
  };
}

describe('voiceActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoomInstance.localParticipant.isMicrophoneEnabled = true;
    mockRoomInstance.localParticipant.metadata = JSON.stringify({ isDeafened: false });
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

      expect(deps.dispatch).toHaveBeenCalledWith({ type: 'SET_CONNECTING', payload: true });
      expect(deps.dispatch).toHaveBeenCalledWith({
        type: 'SET_CONNECTED',
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
      expect(mockRoomInstance.connect).toHaveBeenCalledWith('ws://localhost:7880', 'mock-token');
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
      expect(deps.dispatch).toHaveBeenCalledWith({ type: 'SET_CONNECTION_ERROR', payload: 'Token failed' });
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
      expect(deps.dispatch).toHaveBeenCalledWith({ type: 'SET_DISCONNECTED' });
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
    it('disables mic when currently enabled', async () => {
      mockRoomInstance.localParticipant.isMicrophoneEnabled = true;
      const deps = createMockDeps();
      await toggleMicrophone(deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    });

    it('enables mic when currently disabled', async () => {
      mockRoomInstance.localParticipant.isMicrophoneEnabled = false;
      const deps = createMockDeps();
      await toggleMicrophone(deps);

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
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

      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    });
  });

  describe('toggleDeafenUnified', () => {
    it('dispatches SET_DEAFENED and updates metadata', async () => {
      const deps = createMockDeps({ isDeafened: false });
      await toggleDeafenUnified(deps);

      expect(deps.dispatch).toHaveBeenCalledWith({ type: 'SET_DEAFENED', payload: true });
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
      expect(deps.dispatch).toHaveBeenCalledWith({ type: 'SET_DEAFENED', payload: false });
    });

    it('does not restore mic when undeafening if server-muted', async () => {
      mockRoomInstance.localParticipant.isMicrophoneEnabled = false;
      const deps = createMockDeps({ isDeafened: true, isServerMuted: true, wasMutedBeforeDeafen: false });
      await toggleDeafenUnified(deps);

      // Should undeafen but NOT re-enable mic because server-muted
      expect(deps.dispatch).toHaveBeenCalledWith({ type: 'SET_DEAFENED', payload: false });
      expect(mockRoomInstance.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    });
  });

  describe('switchAudioInputDevice', () => {
    it('calls room.switchActiveDevice and dispatches', async () => {
      const deps = createMockDeps();
      await switchAudioInputDevice('device-123', deps);

      expect(mockRoomInstance.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'device-123');
      expect(deps.dispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_AUDIO_INPUT_ID', payload: 'device-123' });
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
      expect(deps.dispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_AUDIO_OUTPUT_ID', payload: 'device-456' });
    });

    it('returns early when no room or channel', async () => {
      const deps = createMockDeps({ channelId: null, dmGroupId: null });
      await switchAudioOutputDevice('device-456', deps);

      expect(mockRoomInstance.switchActiveDevice).not.toHaveBeenCalled();
    });
  });
});
