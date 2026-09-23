import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { VoiceBottomBar } from '../../components/Voice/VoiceBottomBar';
import { VoiceSessionType, type VoiceState } from '../../contexts/VoiceContext';
import { VideoLayoutMode } from '../../types/videoLayout';

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
  setPipCollapsed: vi.fn(),
  revealVideoTiles: vi.fn(),
  leaveVoiceChannel: vi.fn(),
  switchAudioInputDevice: vi.fn(),
  switchVideoInputDevice: vi.fn(),
  joinVoiceChannel: vi.fn(),
  joinDmVoice: vi.fn(),
  toggleAudio: vi.fn(),
  switchAudioOutputDevice: vi.fn(),
};

const defaultVoiceState: VoiceState & { room: null } = {
  isConnected: true,
  isConnecting: false,
  connectionError: null,
  contextType: VoiceSessionType.Channel,
  currentChannelId: 'ch-1',
  channelName: 'General Voice',
  communityId: 'c1',
  isPrivate: false,
  createdAt: '2025-01-01T00:00:00Z',
  currentDmGroupId: null,
  dmGroupName: null,
  isDeafened: false,
  isServerMuted: false,
  showVideoTiles: false,
  pipCollapsed: false,
  screenShareAudioFailed: false,
  selectedAudioInputId: null,
  selectedAudioOutputId: null,
  selectedVideoInputId: null,
  wasMutedBeforeDeafen: false,
  watchingCameras: new Set<string>(),
  watchingScreenShares: new Set<string>(),
  hiddenLocalTiles: new Set<string>(),
  stageMounted: false,
  layoutMode: VideoLayoutMode.Grid,
  pinnedTileId: null,
  spotlightTileId: null,
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
    pttPress: vi.fn(),
    pttRelease: vi.fn(),
  })),
}));

vi.mock('../../hooks/useWakeLock', () => ({
  useWakeLock: vi.fn(),
}));

vi.mock('../../hooks/useSpeaking', () => ({
  useSpeaking: vi.fn(() => ({
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

vi.mock('../../hooks/useVoiceMediaSession', () => ({
  useVoiceMediaSession: vi.fn(),
}));

vi.mock('../../hooks/useVoiceForegroundResync', () => ({
  useVoiceForegroundResync: vi.fn(),
}));

vi.mock('../../hooks/useServerMuteEffect', () => ({
  useServerMuteEffect: vi.fn(),
}));

vi.mock('../../hooks/useRemoteVolumeEffect', () => ({
  useRemoteVolumeEffect: vi.fn(),
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
const { usePushToTalk } = await import('../../hooks/usePushToTalk');

describe('VoiceBottomBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceState = { ...defaultVoiceState };
    // Reset to defaults — vi.clearAllMocks() does NOT reset mockReturnValue,
    // so every hook a test overrides must be reset here explicitly.
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);
    vi.mocked(useScreenShare).mockReturnValue({
      isScreenSharing: false,
      showSourcePicker: false,
      toggleScreenShare: vi.fn(),
      handleSourcePickerClose: vi.fn(),
      handleSourceSelect: vi.fn(),
      startScreenShare: vi.fn(),
      stopScreenShare: vi.fn(),
    });
    vi.mocked(useLocalMediaState).mockReturnValue({
      isCameraEnabled: false,
      isMicrophoneEnabled: true,
      isScreenShareEnabled: false,
      audioTrack: undefined,
      videoTrack: undefined,
    });
    vi.mocked(useResponsive).mockReturnValue({
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      deviceType: 'desktop',
      shouldUseTouchUI: false,
    } as never);
    vi.mocked(usePushToTalk).mockReturnValue({
      isActive: false,
      isKeyHeld: false,
      currentKeyDisplay: 'Space',
      inputMode: 'voice_activity',
      pttPress: vi.fn(),
      pttRelease: vi.fn(),
    } as never);
    vi.mocked(useReplayBufferState).mockReturnValue({
      isReplayBufferActive: false,
    });
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
      contextType: VoiceSessionType.Dm,
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

  it('video toggle calls toggleVideo', async () => {
    const { user } = renderWithProviders(<VoiceBottomBar />);

    const videoButton = screen.getByRole('button', { name: /turn on camera/i });
    await user.click(videoButton);

    expect(mockActions.toggleVideo).toHaveBeenCalled();
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

    expect(mockToggleScreenShare).toHaveBeenCalled();
  });

  it('screen share button reflects active sharing with StopScreenShare icon', () => {
    vi.mocked(useScreenShare).mockReturnValue({
      isScreenSharing: true,
      showSourcePicker: false,
      toggleScreenShare: vi.fn(),
      handleSourcePickerClose: vi.fn(),
      handleSourceSelect: vi.fn(),
      startScreenShare: vi.fn(),
      stopScreenShare: vi.fn(),
    });

    renderWithProviders(<VoiceBottomBar />);

    expect(screen.getByTestId('StopScreenShareIcon')).toBeInTheDocument();
    expect(screen.queryByTestId('ScreenShareIcon')).not.toBeInTheDocument();
  });

  it('screen share button shows ScreenShare icon when not sharing', () => {
    renderWithProviders(<VoiceBottomBar />);

    expect(screen.getByTestId('ScreenShareIcon')).toBeInTheDocument();
    expect(screen.queryByTestId('StopScreenShareIcon')).not.toBeInTheDocument();
  });

  it('mic button is a no-op when server muted', async () => {
    voiceState = { ...defaultVoiceState, isServerMuted: true };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);

    const { user } = renderWithProviders(<VoiceBottomBar />);

    const micButton = screen.getByTestId('MicIcon').closest('button')!;
    await user.click(micButton);

    expect(mockActions.toggleMute).not.toHaveBeenCalled();
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

  it('"Show Video Tiles" button reveals (show + un-collapse) rather than just showing', async () => {
    voiceState = { ...defaultVoiceState, showVideoTiles: false };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);

    const { user } = renderWithProviders(<VoiceBottomBar />);

    await user.click(screen.getByRole('button', { name: /show video tiles/i }));

    expect(mockActions.revealVideoTiles).toHaveBeenCalled();
    expect(mockActions.setShowVideoTiles).not.toHaveBeenCalled();
  });

  describe('settings menu video-tiles toggle', () => {
    async function openSettingsMenu(user: ReturnType<typeof renderWithProviders>['user']) {
      const settingsIcon = screen.getByTestId('SettingsIcon');
      await user.click(settingsIcon.closest('button')!);
    }

    it('expanded (shown, not collapsed): "Hide Video Tiles" collapses the pill', async () => {
      voiceState = { ...defaultVoiceState, showVideoTiles: true, pipCollapsed: false };
      vi.mocked(useVoiceConnection).mockReturnValue({
        state: voiceState,
        actions: mockActions,
      } as never);

      const { user } = renderWithProviders(<VoiceBottomBar />);
      await openSettingsMenu(user);

      const item = await screen.findByText('Hide Video Tiles');
      await user.click(item);

      expect(mockActions.setPipCollapsed).toHaveBeenCalledWith(true);
      expect(mockActions.revealVideoTiles).not.toHaveBeenCalled();
      expect(mockActions.setShowVideoTiles).not.toHaveBeenCalled();
    });

    it('hidden (showVideoTiles false): "Show Video Tiles" reveals fully', async () => {
      voiceState = { ...defaultVoiceState, showVideoTiles: false, pipCollapsed: false };
      vi.mocked(useVoiceConnection).mockReturnValue({
        state: voiceState,
        actions: mockActions,
      } as never);

      const { user } = renderWithProviders(<VoiceBottomBar />);
      await openSettingsMenu(user);

      const item = await screen.findByText('Show Video Tiles');
      await user.click(item);

      expect(mockActions.revealVideoTiles).toHaveBeenCalled();
      expect(mockActions.setPipCollapsed).not.toHaveBeenCalled();
    });

    it('collapsed to a pill (showVideoTiles true, pipCollapsed true): "Show Video Tiles" reveals fully', async () => {
      voiceState = { ...defaultVoiceState, showVideoTiles: true, pipCollapsed: true };
      vi.mocked(useVoiceConnection).mockReturnValue({
        state: voiceState,
        actions: mockActions,
      } as never);

      const { user } = renderWithProviders(<VoiceBottomBar />);
      await openSettingsMenu(user);

      const item = await screen.findByText('Show Video Tiles');
      await user.click(item);

      expect(mockActions.revealVideoTiles).toHaveBeenCalled();
      expect(mockActions.setPipCollapsed).not.toHaveBeenCalled();
    });

    it('hides the video-tiles menu item entirely while the embedded stage is mounted (toggling pip state would have no visible effect)', async () => {
      voiceState = { ...defaultVoiceState, showVideoTiles: true, pipCollapsed: false, stageMounted: true };
      vi.mocked(useVoiceConnection).mockReturnValue({
        state: voiceState,
        actions: mockActions,
      } as never);

      const { user } = renderWithProviders(<VoiceBottomBar />);
      await openSettingsMenu(user);

      expect(screen.queryByText('Hide Video Tiles')).not.toBeInTheDocument();
      expect(screen.queryByText('Show Video Tiles')).not.toBeInTheDocument();
      // The rest of the menu is unaffected.
      expect(screen.getByText('Voice & Video Settings')).toBeInTheDocument();
    });
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
        delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId;
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
        delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId;
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

  describe('hold-to-talk (touch PTT)', () => {
    const mockPttPress = vi.fn();
    const mockPttRelease = vi.fn();

    function enableHoldToTalk() {
      vi.mocked(usePushToTalk).mockReturnValue({
        isActive: true,
        isKeyHeld: false,
        currentKeyDisplay: 'Space',
        inputMode: 'push_to_talk',
        pttPress: mockPttPress,
        pttRelease: mockPttRelease,
      } as never);
      vi.mocked(useResponsive).mockReturnValue({
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        deviceType: 'phone',
        shouldUseTouchUI: true,
      } as never);
    }

    it('pointerdown engages transmit and pointerup releases it', () => {
      enableHoldToTalk();
      renderWithProviders(<VoiceBottomBar />);

      const micButton = screen.getByTestId('MicIcon').closest('button')!;

      fireEvent.pointerDown(micButton, { pointerId: 1 });
      expect(mockPttPress).toHaveBeenCalledTimes(1);

      fireEvent.pointerUp(micButton, { pointerId: 1 });
      expect(mockPttRelease).toHaveBeenCalledTimes(1);
    });

    it('exposes an accessible "Hold to talk" label', () => {
      enableHoldToTalk();
      renderWithProviders(<VoiceBottomBar />);

      expect(screen.getByRole('button', { name: /hold to talk/i })).toBeInTheDocument();
    });

    it('does not engage transmit while server-muted', () => {
      enableHoldToTalk();
      voiceState = { ...defaultVoiceState, isServerMuted: true };
      vi.mocked(useVoiceConnection).mockReturnValue({
        state: voiceState,
        actions: mockActions,
      } as never);

      renderWithProviders(<VoiceBottomBar />);

      const micButton = screen.getByTestId('MicIcon').closest('button')!;
      fireEvent.pointerDown(micButton, { pointerId: 1 });

      expect(mockPttPress).not.toHaveBeenCalled();
    });

    it('does NOT attach hold-to-talk for desktop PTT (no touch UI regression)', () => {
      // PTT active but desktop (keyboard) — mic button stays a keyboard-only
      // control with no onClick and no pointer transmit.
      vi.mocked(usePushToTalk).mockReturnValue({
        isActive: true,
        isKeyHeld: false,
        currentKeyDisplay: 'Space',
        inputMode: 'push_to_talk',
        pttPress: mockPttPress,
        pttRelease: mockPttRelease,
      } as never);
      vi.mocked(useResponsive).mockReturnValue({
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        deviceType: 'desktop',
        shouldUseTouchUI: false,
      } as never);

      renderWithProviders(<VoiceBottomBar />);

      const micButton = screen.getByTestId('MicIcon').closest('button')!;
      fireEvent.pointerDown(micButton, { pointerId: 1 });
      fireEvent.click(micButton);

      expect(mockPttPress).not.toHaveBeenCalled();
      expect(mockActions.toggleMute).not.toHaveBeenCalled();
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
