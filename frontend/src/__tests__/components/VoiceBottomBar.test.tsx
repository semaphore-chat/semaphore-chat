import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { VoiceBottomBar } from '../../components/Voice/VoiceBottomBar';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// Default mock values
const mockActions = {
  toggleMute: vi.fn(),
  toggleDeafen: vi.fn(),
  toggleVideo: vi.fn(),
  toggleScreenShare: vi.fn(),
  setShowVideoTiles: vi.fn(),
  leaveVoiceChannel: vi.fn(),
  switchAudioInputDevice: vi.fn(),
  switchVideoInputDevice: vi.fn(),
  requestMaximize: vi.fn(),
  joinVoiceChannel: vi.fn(),
  joinDmVoice: vi.fn(),
  toggleAudio: vi.fn(),
  switchAudioOutputDevice: vi.fn(),
};

const defaultVoiceState = {
  isConnected: true,
  isConnecting: false,
  connectionError: null,
  contextType: 'channel' as const,
  currentChannelId: 'ch-1',
  channelName: 'General Voice',
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

let voiceState = { ...defaultVoiceState };

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: vi.fn(() => ({
    state: voiceState,
    actions: mockActions,
  })),
}));

vi.mock('../../hooks/useScreenShare', () => ({
  useScreenShare: vi.fn(() => ({
    isScreenSharing: false,
    showSourcePicker: false,
    toggleScreenShare: vi.fn(),
    handleSourcePickerClose: vi.fn(),
    handleSourceSelect: vi.fn(),
  })),
}));

vi.mock('../../hooks/useLocalMediaState', () => ({
  useLocalMediaState: vi.fn(() => ({
    isCameraEnabled: false,
    isMicrophoneEnabled: true,
    isScreenShareEnabled: false,
  })),
}));

vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: vi.fn(() => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    deviceType: 'desktop',
  })),
}));

vi.mock('../../contexts/ReplayBufferContext', () => ({
  useReplayBufferState: vi.fn(() => ({
    isReplayBufferActive: false,
  })),
}));

vi.mock('../../hooks/useDebugPanelShortcut', () => ({
  useDebugPanelShortcut: vi.fn(() => ({
    showDebugPanel: false,
    toggleDebugPanel: vi.fn(),
    setShowDebugPanel: vi.fn(),
  })),
}));

vi.mock('../../hooks/usePushToTalk', () => ({
  usePushToTalk: vi.fn(() => ({
    isActive: false,
    isKeyHeld: false,
    currentKeyDisplay: 'Space',
    inputMode: 'voice_activity',
  })),
}));

vi.mock('../../hooks/useSpeakingDetection', () => ({
  useSpeakingDetection: vi.fn(() => ({
    speakingMap: new Map(),
    isSpeaking: () => false,
  })),
}));

vi.mock('../../hooks/useDeafenEffect', () => ({
  useDeafenEffect: vi.fn(),
}));

vi.mock('../../hooks/useVoicePresenceHeartbeat', () => ({
  useVoicePresenceHeartbeat: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../components/Voice/DeviceSettingsDialog', () => ({
  DeviceSettingsDialog: () => null,
}));

vi.mock('../../components/Voice/ScreenSourcePicker', () => ({
  ScreenSourcePicker: () => null,
}));

vi.mock('../../components/Voice/VoiceDebugPanel', () => ({
  VoiceDebugPanel: () => null,
}));

vi.mock('../../components/Voice/CaptureReplayModal', () => ({
  CaptureReplayModal: () => null,
}));

// Import mocked hooks for overriding in specific tests
const { useVoiceConnection } = await import('../../hooks/useVoiceConnection');
const { useLocalMediaState } = await import('../../hooks/useLocalMediaState');
const { useResponsive } = await import('../../hooks/useResponsive');
const { useReplayBufferState } = await import('../../contexts/ReplayBufferContext');
const { useScreenShare } = await import('../../hooks/useScreenShare');

describe('VoiceBottomBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceState = { ...defaultVoiceState };
    // Reset to defaults
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);
  });

  it('returns null when not connected', () => {
    voiceState = { ...defaultVoiceState, isConnected: false };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);

    const { container } = renderWithProviders(<VoiceBottomBar />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when connected but no channel or DM', () => {
    voiceState = { ...defaultVoiceState, isConnected: true, currentChannelId: null, currentDmGroupId: null };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);

    const { container } = renderWithProviders(<VoiceBottomBar />);
    expect(container.innerHTML).toBe('');
  });

  it('renders channel name and "Voice Connected" label', () => {
    renderWithProviders(<VoiceBottomBar />);

    expect(screen.getByText('General Voice')).toBeInTheDocument();
    expect(screen.getByText('Voice Connected')).toBeInTheDocument();
  });

  it('renders DM name and "DM Voice Call" label', () => {
    voiceState = {
      ...defaultVoiceState,
      contextType: 'dm',
      currentChannelId: null,
      currentDmGroupId: 'dm-1',
      dmGroupName: 'Group Chat',
      channelName: null,
    };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);

    renderWithProviders(<VoiceBottomBar />);

    expect(screen.getByText('Group Chat')).toBeInTheDocument();
    expect(screen.getByText('DM Voice Call')).toBeInTheDocument();
  });

  it('mute button calls toggleMute', async () => {
    const { user } = renderWithProviders(<VoiceBottomBar />);

    // The mic button has Mic icon - find by tooltip "Mute"
    const muteButton = screen.getByRole('button', { name: /mute/i });
    await user.click(muteButton);

    expect(mockActions.toggleMute).toHaveBeenCalled();
  });

  it('shows MicOff icon when muted', () => {
    vi.mocked(useLocalMediaState).mockReturnValue({
      isCameraEnabled: false,
      isMicrophoneEnabled: false,
      isScreenShareEnabled: false,
      audioTrack: undefined,
      videoTrack: undefined,
    });

    renderWithProviders(<VoiceBottomBar />);

    expect(screen.getByTestId('MicOffIcon')).toBeInTheDocument();
  });

  it('deafen button calls toggleDeafen', async () => {
    const { user } = renderWithProviders(<VoiceBottomBar />);

    const deafenButton = screen.getByRole('button', { name: /deafen/i });
    await user.click(deafenButton);

    expect(mockActions.toggleDeafen).toHaveBeenCalled();
  });

  it('shows HeadsetOff when deafened', () => {
    voiceState = { ...defaultVoiceState, isDeafened: true };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);

    renderWithProviders(<VoiceBottomBar />);

    expect(screen.getByTestId('HeadsetOffIcon')).toBeInTheDocument();
  });

  it('video toggle calls toggleVideo and enables tiles', async () => {
    const { user } = renderWithProviders(<VoiceBottomBar />);

    const videoButton = screen.getByRole('button', { name: /turn on camera/i });
    await user.click(videoButton);

    expect(mockActions.toggleVideo).toHaveBeenCalled();
    expect(mockActions.setShowVideoTiles).toHaveBeenCalledWith(true);
  });

  it('disconnect button calls leaveVoiceChannel', async () => {
    const { user } = renderWithProviders(<VoiceBottomBar />);

    const disconnectButton = screen.getByRole('button', { name: /disconnect/i });
    await user.click(disconnectButton);

    expect(mockActions.leaveVoiceChannel).toHaveBeenCalled();
  });

  it('shows capture replay button when replay active', () => {
    vi.mocked(useReplayBufferState).mockReturnValue({
      isReplayBufferActive: true,
    });

    renderWithProviders(<VoiceBottomBar />);

    expect(screen.getByRole('button', { name: /capture replay/i })).toBeInTheDocument();
  });

  it('hides capture replay button when inactive', () => {
    vi.mocked(useReplayBufferState).mockReturnValue({
      isReplayBufferActive: false,
    });

    renderWithProviders(<VoiceBottomBar />);

    expect(screen.queryByRole('button', { name: /capture replay/i })).not.toBeInTheDocument();
  });

  it('shows connected chip', () => {
    renderWithProviders(<VoiceBottomBar />);

    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('hides deafen and settings on mobile', () => {
    vi.mocked(useResponsive).mockReturnValue({
      isMobile: true,
      isTablet: false,
      isDesktop: false,
      deviceType: 'phone',
    } as never);

    renderWithProviders(<VoiceBottomBar />);

    expect(screen.queryByRole('button', { name: /deafen/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /voice settings/i })).not.toBeInTheDocument();
  });

  it('screen share toggle calls handler', async () => {
    const mockToggleScreenShare = vi.fn();
    vi.mocked(useScreenShare).mockReturnValue({
      isScreenSharing: false,
      showSourcePicker: false,
      toggleScreenShare: mockToggleScreenShare,
      handleSourcePickerClose: vi.fn(),
      handleSourceSelect: vi.fn(),
      startScreenShare: vi.fn(),
      stopScreenShare: vi.fn(),
    });

    const { user } = renderWithProviders(<VoiceBottomBar />);

    // The screen share button is inside a Badge wrapper, so Tooltip's aria-label goes on the Badge span, not the button.
    // Find the button via the icon's data-testid.
    const shareIcon = screen.getByTestId('ScreenShareIcon');
    const shareButton = shareIcon.closest('button')!;
    await user.click(shareButton);

    // handleToggleScreenShare calls actions.setShowVideoTiles(true) then screenShare.toggleScreenShare()
    expect(mockActions.setShowVideoTiles).toHaveBeenCalledWith(true);
    expect(mockToggleScreenShare).toHaveBeenCalled();
  });

  it('shows "Show Video Tiles" button when connected and tiles are hidden, even without local camera', () => {
    // No local camera or screen share active
    vi.mocked(useLocalMediaState).mockReturnValue({
      isCameraEnabled: false,
      isMicrophoneEnabled: true,
      isScreenShareEnabled: false,
      audioTrack: undefined,
      videoTrack: undefined,
    });
    vi.mocked(useScreenShare).mockReturnValue({
      isScreenSharing: false,
      showSourcePicker: false,
      toggleScreenShare: vi.fn(),
      handleSourcePickerClose: vi.fn(),
      handleSourceSelect: vi.fn(),
      startScreenShare: vi.fn(),
      stopScreenShare: vi.fn(),
    });

    // showVideoTiles is false, but user is connected
    voiceState = { ...defaultVoiceState, showVideoTiles: false };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);

    renderWithProviders(<VoiceBottomBar />);

    expect(screen.getByRole('button', { name: /show video tiles/i })).toBeInTheDocument();
  });

  it('hides "Show Video Tiles" button when tiles are already shown', () => {
    voiceState = { ...defaultVoiceState, showVideoTiles: true };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);

    renderWithProviders(<VoiceBottomBar />);

    expect(screen.queryByRole('button', { name: /show video tiles/i })).not.toBeInTheDocument();
  });

  describe('speakerphone toggle (#109)', () => {
    let savedSetSinkId: PropertyDescriptor | undefined;

    beforeEach(() => {
      // Save original setSinkId state for safe restore
      savedSetSinkId = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'setSinkId');

      // Mock enumerateDevices for speakerphone handler
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          enumerateDevices: vi.fn().mockResolvedValue([
            { kind: 'audiooutput', deviceId: 'default', label: 'Default' },
            { kind: 'audiooutput', deviceId: 'communications', label: 'Communications' },
          ]),
        },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      // Guarantee cleanup even if test throws
      if (savedSetSinkId) {
        Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', savedSetSinkId);
      } else {
        delete (HTMLMediaElement.prototype as Record<string, unknown>).setSinkId;
      }
    });

    function enableSetSinkId() {
      Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
        value: vi.fn(),
        writable: true,
        configurable: true,
      });
    }

    function disableSetSinkId() {
      if ('setSinkId' in HTMLMediaElement.prototype) {
        delete (HTMLMediaElement.prototype as Record<string, unknown>).setSinkId;
      }
    }

    it('does not show speakerphone button on desktop', () => {
      vi.mocked(useResponsive).mockReturnValue({
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        deviceType: 'desktop',
      } as never);

      renderWithProviders(<VoiceBottomBar />);

      expect(screen.queryByTestId('SpeakerPhoneIcon')).not.toBeInTheDocument();
      expect(screen.queryByTestId('PhoneInTalkIcon')).not.toBeInTheDocument();
    });

    it('shows speakerphone button on mobile when setSinkId is supported', () => {
      vi.mocked(useResponsive).mockReturnValue({
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        deviceType: 'phone',
      } as never);
      enableSetSinkId();

      renderWithProviders(<VoiceBottomBar />);

      expect(screen.getByTestId('PhoneInTalkIcon')).toBeInTheDocument();
    });

    it('calls switchAudioOutputDevice with default device ID when toggled to speaker', async () => {
      vi.mocked(useResponsive).mockReturnValue({
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        deviceType: 'phone',
      } as never);
      enableSetSinkId();

      const { user } = renderWithProviders(<VoiceBottomBar />);

      const speakerButton = screen.getByTestId('PhoneInTalkIcon').closest('button')!;
      await user.click(speakerButton);

      // Toggling to speaker should select the default device
      expect(mockActions.switchAudioOutputDevice).toHaveBeenCalledWith('default');
    });

    it('does not show speakerphone button when setSinkId is not supported', () => {
      vi.mocked(useResponsive).mockReturnValue({
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        deviceType: 'phone',
      } as never);
      disableSetSinkId();

      renderWithProviders(<VoiceBottomBar />);

      expect(screen.queryByTestId('SpeakerPhoneIcon')).not.toBeInTheDocument();
      expect(screen.queryByTestId('PhoneInTalkIcon')).not.toBeInTheDocument();
    });
  });

  it('settings menu has "All Settings" item that navigates to /settings', async () => {
    // Ensure desktop mode so settings button is visible
    vi.mocked(useResponsive).mockReturnValue({
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      deviceType: 'desktop',
    } as never);

    const { user } = renderWithProviders(<VoiceBottomBar />);

    // Open settings menu via the Settings icon button
    const settingsIcon = screen.getByTestId('SettingsIcon');
    const settingsButton = settingsIcon.closest('button')!;
    await user.click(settingsButton);

    // Click "All Settings"
    const allSettingsItem = await screen.findByText('All Settings');
    await user.click(allSettingsItem);

    expect(mockNavigate).toHaveBeenCalledWith('/settings');
  });
});
