import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { VoiceChannelUserList } from '../../components/Voice/VoiceChannelUserList';
import { ChannelType } from '../../types/channel.type';
import { EventEmitter } from 'events';

// Mock API client
vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// Mock UserAvatar
vi.mock('../../components/Common/UserAvatar', () => ({
  default: ({ user }: { user: { username?: string } }) => (
    <div data-testid="user-avatar">{user?.username}</div>
  ),
}));

// Mock VoiceUserContextMenu
vi.mock('../../components/Voice/VoiceUserContextMenu', () => ({
  default: () => null,
}));

// Mock livekit-client
vi.mock('livekit-client', () => ({
  RoomEvent: {
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    Connected: 'connected',
    ParticipantMetadataChanged: 'participantMetadataChanged',
  },
}));

// Mock getUserInfo
vi.mock('../../features/users/userApiHelpers', () => ({
  getUserInfo: vi.fn().mockResolvedValue({ avatarUrl: null }),
}));

// Voice connection mock
const mockSetShowVideoTiles = vi.fn();
const mockActions = {
  toggleMute: vi.fn(),
  toggleDeafen: vi.fn(),
  toggleVideo: vi.fn(),
  toggleScreenShare: vi.fn(),
  setShowVideoTiles: mockSetShowVideoTiles,
  leaveVoiceChannel: vi.fn(),
  switchAudioInputDevice: vi.fn(),
  switchVideoInputDevice: vi.fn(),
  switchAudioOutputDevice: vi.fn(),
  requestMaximize: vi.fn(),
  joinVoiceChannel: vi.fn(),
  joinDmVoice: vi.fn(),
  toggleAudio: vi.fn(),
};

/** Create a mock LiveKit room with a local participant */
function createMockRoom(localIdentity: string) {
  const emitter = new EventEmitter();
  return {
    localParticipant: {
      identity: localIdentity,
      name: localIdentity,
      metadata: null,
    },
    remoteParticipants: new Map(),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
  };
}

let voiceState: Record<string, unknown>;

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: vi.fn(() => ({
    state: voiceState,
    actions: mockActions,
  })),
}));

vi.mock('../../hooks/useSpeakingDetection', () => ({
  useSpeakingDetection: vi.fn(() => ({
    speakingMap: new Map(),
    isSpeaking: () => false,
  })),
}));

// Mock useParticipantTracks to control video/screenshare state per user
const mockParticipantTracks = vi.fn();
vi.mock('../../hooks/useParticipantTracks', () => ({
  useParticipantTracks: (...args: unknown[]) => mockParticipantTracks(...args),
}));

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: vi.fn(() => ({
    openProfile: vi.fn(),
  })),
}));

// Mock backend presence for non-connected channels
vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    voicePresenceControllerGetChannelPresenceOptions: vi.fn(() => ({
      queryKey: ['voicePresence', 'voice-ch-1'],
      queryFn: async () => ({
        channelId: 'voice-ch-1',
        users: [
          {
            id: 'user-1',
            username: 'alice',
            displayName: 'Alice',
            avatarUrl: null,
            joinedAt: '2025-01-01T00:00:00Z',
            isMuted: false,
            isDeafened: false,
            isVideoEnabled: true,
            isScreenSharing: true,
          },
        ],
        count: 1,
      }),
    })),
  };
});

const voiceChannel = {
  id: 'voice-ch-1',
  name: 'Voice Channel',
  type: ChannelType.VOICE,
  communityId: 'c1',
  isPrivate: false,
  createdAt: '2025-01-01T00:00:00Z',
};

describe('VoiceChannelUserList - Clickable Icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: participant has video and screen share
    mockParticipantTracks.mockReturnValue({
      participant: { identity: 'user-1' },
      isMicrophoneEnabled: true,
      isCameraEnabled: true,
      isScreenShareEnabled: true,
      isDeafened: false,
    });
  });

  describe('when connected to the channel (LiveKit data)', () => {
    beforeEach(() => {
      const mockRoom = createMockRoom('user-1');
      voiceState = {
        isConnected: true,
        isConnecting: false,
        connectionError: null,
        contextType: 'channel',
        currentChannelId: 'voice-ch-1',
        channelName: 'Voice Channel',
        communityId: 'c1',
        isPrivate: false,
        createdAt: '2025-01-01T00:00:00Z',
        currentDmGroupId: null,
        dmGroupName: null,
        isDeafened: false,
        showVideoTiles: false,
        screenShareAudioFailed: false,
        requestMaximize: false,
        selectedAudioInputId: null,
        selectedAudioOutputId: null,
        selectedVideoInputId: null,
        room: mockRoom,
      };
    });

    it('wraps video icon in a clickable button', async () => {
      renderWithProviders(
        <VoiceChannelUserList channel={voiceChannel} showCompact />,
      );

      const videocamIcon = await screen.findByTestId('VideocamIcon');
      const button = videocamIcon.closest('button');
      expect(button).not.toBeNull();
    });

    it('calls setShowVideoTiles(true) when clicking video icon', async () => {
      const { user } = renderWithProviders(
        <VoiceChannelUserList channel={voiceChannel} showCompact />,
      );

      const videocamIcon = await screen.findByTestId('VideocamIcon');
      const button = videocamIcon.closest('button')!;
      await user.click(button);

      expect(mockSetShowVideoTiles).toHaveBeenCalledWith(true);
    });

    it('wraps screen share icon in a clickable button', async () => {
      renderWithProviders(
        <VoiceChannelUserList channel={voiceChannel} showCompact />,
      );

      const screenShareIcon = await screen.findByTestId('ScreenShareIcon');
      const button = screenShareIcon.closest('button');
      expect(button).not.toBeNull();
    });

    it('calls setShowVideoTiles(true) when clicking screen share icon', async () => {
      const { user } = renderWithProviders(
        <VoiceChannelUserList channel={voiceChannel} showCompact />,
      );

      const screenShareIcon = await screen.findByTestId('ScreenShareIcon');
      const button = screenShareIcon.closest('button')!;
      await user.click(button);

      expect(mockSetShowVideoTiles).toHaveBeenCalledWith(true);
    });
  });

  describe('when NOT connected to the channel (backend presence data)', () => {
    beforeEach(() => {
      voiceState = {
        isConnected: true,
        isConnecting: false,
        connectionError: null,
        contextType: 'channel',
        currentChannelId: 'other-channel-id',
        channelName: 'Other Channel',
        communityId: 'c1',
        isPrivate: false,
        createdAt: '2025-01-01T00:00:00Z',
        currentDmGroupId: null,
        dmGroupName: null,
        isDeafened: false,
        showVideoTiles: false,
        screenShareAudioFailed: false,
        requestMaximize: false,
        selectedAudioInputId: null,
        selectedAudioOutputId: null,
        selectedVideoInputId: null,
        room: null,
      };

      // No LiveKit participant when not connected
      mockParticipantTracks.mockReturnValue({
        participant: null,
        isMicrophoneEnabled: false,
        isCameraEnabled: false,
        isScreenShareEnabled: false,
        isDeafened: false,
      });
    });

    it('shows video icon without a button wrapper', async () => {
      renderWithProviders(
        <VoiceChannelUserList channel={voiceChannel} showCompact />,
      );

      const videocamIcon = await screen.findByTestId('VideocamIcon');
      const button = videocamIcon.closest('button');
      expect(button).toBeNull();
    });

    it('shows screen share icon without a button wrapper', async () => {
      renderWithProviders(
        <VoiceChannelUserList channel={voiceChannel} showCompact />,
      );

      const screenShareIcon = await screen.findByTestId('ScreenShareIcon');
      const button = screenShareIcon.closest('button');
      expect(button).toBeNull();
    });

    it('does not call setShowVideoTiles when icons are not wrapped in buttons', async () => {
      renderWithProviders(
        <VoiceChannelUserList channel={voiceChannel} showCompact />,
      );

      await screen.findByTestId('VideocamIcon');
      // No click possible on non-button icon, verify action not called
      await waitFor(() => {
        expect(mockSetShowVideoTiles).not.toHaveBeenCalled();
      });
    });
  });
});
