import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, act, render } from '@testing-library/react';
import { ThemeProvider, getContrastRatio } from '@mui/material/styles';
import { compositeOver } from '../test-utils/color';
import { generateTheme } from '../../theme/themeConfig';
import { ConnectionQualityIndicator } from '../../components/Voice/ConnectionQualityIndicator';
import { renderWithProviders } from '../test-utils';
import { VoiceBottomBarContent as VoiceBottomBar } from '../../components/Voice/VoiceBottomBarContent';
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
  cancelReconnect: vi.fn(),
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
  reconnect: null,
  lastEnded: null,
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

const allowedPublish = {
  canSpeak: true,
  canVideo: true,
  canShare: true,
  speakBlockedReason: "You can't speak in this channel",
  videoBlockedReason: "You can't use video in this channel",
  shareBlockedReason: "You can't share your screen in this channel",
};
vi.mock('../../hooks/useVoicePublishPermissions', () => ({
  useVoicePublishPermissions: vi.fn(() => allowedPublish),
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

vi.mock('../../components/Voice/SoundboardButton', () => ({
  SoundboardButton: () => <button aria-label="Open soundboard">sb</button>,
}));

// Electron flag for the real-useResponsive tests below (Review Focus 1).
const platform = vi.hoisted(() => ({ electron: false }));
vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isElectron: () => platform.electron,
  isWeb: () => !platform.electron,
}));

// Import mocked hooks for overriding in specific tests
const { useVoiceConnection } = await import('../../hooks/useVoiceConnection');
const { useLocalMediaState } = await import('../../hooks/useLocalMediaState');
const { useResponsive } = await import('../../hooks/useResponsive');
const { useReplayBufferState } = await import('../../contexts/ReplayBufferContext');
const { useScreenShare } = await import('../../hooks/useScreenShare');
const { usePushToTalk } = await import('../../hooks/usePushToTalk');
const { useVoicePublishPermissions } = await import('../../hooks/useVoicePublishPermissions');

describe('VoiceBottomBarContent', () => {
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
    vi.mocked(useVoicePublishPermissions).mockReturnValue(allowedPublish);
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

  describe('automatic rejoin (connection dropped)', () => {
    const reconnecting = (isMobile: boolean) => {
      voiceState = { ...defaultVoiceState, reconnect: { attempt: 3, maxAttempts: 11, nextRetryAt: Date.now() + 5000 } };
      vi.mocked(useVoiceConnection).mockReturnValue({ state: voiceState, actions: mockActions } as never);
      vi.mocked(useResponsive).mockReturnValue({
        isMobile,
        isTablet: false,
        isDesktop: !isMobile,
        deviceType: isMobile ? 'mobile' : 'desktop',
        shouldUseTouchUI: isMobile,
      } as never);
    };

    it.each([false, true])('shows "Reconnecting voice (n)…" in place of the status (mobile: %s)', (isMobile) => {
      reconnecting(isMobile);
      renderWithProviders(<VoiceBottomBar />);

      expect(screen.getByRole('status')).toHaveTextContent('Reconnecting voice (3)…');
      expect(screen.getByText('General Voice')).toBeInTheDocument();
      expect(screen.queryByText('Voice Connected')).not.toBeInTheDocument();
    });

    it('touch tablet: status in its own row, no "Voice Connected" while reconnecting', () => {
      reconnecting(false);
      vi.mocked(useResponsive).mockReturnValue({
        isMobile: false,
        isTablet: true,
        isDesktop: false,
        deviceType: 'tablet',
        shouldUseTouchUI: true,
      } as never);
      renderWithProviders(<VoiceBottomBar />);

      expect(screen.getByRole('status')).toHaveTextContent('Reconnecting voice (3)…');
      expect(screen.queryByText('Voice Connected')).not.toBeInTheDocument();
    });

    it('Cancel stops reconnecting', async () => {
      reconnecting(false);
      const { user } = renderWithProviders(<VoiceBottomBar />);

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(mockActions.cancelReconnect).toHaveBeenCalled();
    });

    it('shows no reconnect status while connected normally', () => {
      renderWithProviders(<VoiceBottomBar />);
      expect(screen.queryByTestId('voice-reconnecting')).not.toBeInTheDocument();
    });
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

    const videoButton = screen.getByRole('button', { name: /^camera$/i });
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

  describe('connection quality (replaces the "Connected" chip)', () => {
    type Handler = (...args: unknown[]) => void;
    function fakeRoom(quality: string) {
      const handlers = new Map<string, Set<Handler>>();
      const localParticipant = { connectionQuality: quality };
      return {
        state: 'connected',
        localParticipant,
        on: vi.fn((e: string, h: Handler) => {
          if (!handlers.has(e)) handlers.set(e, new Set());
          handlers.get(e)!.add(h);
        }),
        off: vi.fn((e: string, h: Handler) => handlers.get(e)?.delete(h)),
        emit: (e: string, ...args: unknown[]) => handlers.get(e)?.forEach((h) => h(...args)),
      };
    }
    function renderWithRoom(room: ReturnType<typeof fakeRoom>) {
      voiceState = { ...defaultVoiceState, room: room as never };
      vi.mocked(useVoiceConnection).mockReturnValue({ state: voiceState, actions: mockActions } as never);
      return renderWithProviders(<VoiceBottomBar />);
    }

    it('no longer shows a "Connected" pill next to "Voice Connected"', () => {
      renderWithProviders(<VoiceBottomBar />);
      expect(screen.queryByText('Connected')).not.toBeInTheDocument();
      expect(screen.getByText('Voice Connected')).toBeInTheDocument();
    });

    it.each([
      ['excellent', '3', 'Connection: Excellent'],
      ['good', '2', 'Connection: Good'],
      ['poor', '1', 'Connection: Poor'],
      ['lost', '0', 'Connection: Lost'],
      ['unknown', '0', 'Connection: Measuring…'],
    ])('shows %s quality as %s bars', (quality, bars, label) => {
      renderWithRoom(fakeRoom(quality));
      const indicator = screen.getByTestId('connection-quality');
      expect(indicator).toHaveAttribute('data-bars', bars);
      expect(indicator).toHaveAccessibleName(label);
    });

    it('follows the local participant\'s quality changes and ignores remote ones', () => {
      const room = fakeRoom('excellent');
      renderWithRoom(room);
      act(() => room.emit('connectionQualityChanged', 'poor', { identity: 'someone-else' }));
      expect(screen.getByTestId('connection-quality')).toHaveAttribute('data-bars', '3');
      act(() => room.emit('connectionQualityChanged', 'poor', room.localParticipant));
      expect(screen.getByTestId('connection-quality')).toHaveAttribute('data-bars', '1');
    });

    it('says when it is reconnecting', () => {
      const room = fakeRoom('good');
      renderWithRoom(room);
      act(() => room.emit('reconnecting'));
      expect(screen.getByTestId('connection-quality')).toHaveAccessibleName('Connection: Reconnecting…');
      act(() => room.emit('reconnected'));
      expect(screen.getByTestId('connection-quality')).toHaveAccessibleName('Connection: Good');
    });

    it('starts from the room\'s own state: a room that is reconnecting shows it', () => {
      const room = { ...fakeRoom('good'), state: 'reconnecting' };
      renderWithRoom(room);
      expect(screen.getByTestId('connection-quality')).toHaveAccessibleName('Connection: Reconnecting…');
    });

    it('does not stay on "Reconnecting…" after the room disconnects or is replaced', () => {
      const room = fakeRoom('good');
      const { rerender } = renderWithRoom(room);
      act(() => room.emit('reconnecting'));
      act(() => room.emit('disconnected'));
      expect(screen.getByTestId('connection-quality')).toHaveAccessibleName('Connection: Good');

      act(() => room.emit('reconnecting'));
      const next = { ...fakeRoom('excellent'), state: 'connected' };
      voiceState = { ...defaultVoiceState, room: next as never };
      vi.mocked(useVoiceConnection).mockReturnValue({ state: voiceState, actions: mockActions } as never);
      rerender(<VoiceBottomBar />);
      expect(screen.getByTestId('connection-quality')).toHaveAccessibleName('Connection: Excellent');
    });

    it.each([
      ['light', 'purple', 'vibrant'],
      ['light', 'amber', 'balanced'],
      ['light', 'teal', 'minimal'],
      ['dark', 'teal', 'minimal'],
      ['dark', 'lime', 'vibrant'],
    ] as const)('lit bars reach 3:1 non-text contrast on the bar (%s, %s, %s)', (mode, accent, intensity) => {
      const theme = generateTheme(mode, accent, intensity);
      // Every lit bar colour (positive for good/excellent, warning for poor),
      // against the bar's own surface — the WCAG 1.4.11 non-text minimum.
      for (const quality of ['excellent', 'good', 'poor']) {
        const { unmount } = render(
          <ThemeProvider theme={theme}>
            <ConnectionQualityIndicator room={fakeRoom(quality) as never} />
          </ThemeProvider>,
        );
        const indicator = screen.getByTestId('connection-quality');
        const litCount = Number(indicator.getAttribute('data-bars'));
        expect(litCount).toBeGreaterThan(0);
        for (const bar of Array.from(indicator.children).slice(0, litCount)) {
          const painted = compositeOver(getComputedStyle(bar).backgroundColor, theme.palette.background.paper);
          expect(getContrastRatio(painted, theme.palette.background.paper)).toBeGreaterThanOrEqual(3);
        }
        unmount();
      }
    });

    it('is not shown on phone', () => {
      vi.mocked(useResponsive).mockReturnValue({
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        deviceType: 'phone',
      } as never);
      renderWithRoom(fakeRoom('good'));
      expect(screen.queryByTestId('connection-quality')).not.toBeInTheDocument();
    });
  });

  it('groups the desktop controls as [mic, deafen] · [camera, share] · [extras, settings] · hang up', () => {
    renderWithProviders(<VoiceBottomBar />);
    const controls = screen.getByTestId('voice-bar-controls');
    const sequence = Array.from(controls.querySelectorAll('button, hr, [role="separator"]')).map((el) =>
      el.tagName === 'BUTTON' ? el.getAttribute('aria-label') : '|',
    );
    const at = (pattern: RegExp) => sequence.findIndex((x) => x !== '|' && pattern.test(x ?? ''));
    const dividersBetween = (a: number, b: number) =>
      sequence.slice(Math.min(a, b) + 1, Math.max(a, b)).filter((x) => x === '|').length;
    const mic = at(/mute/i);
    const deafen = at(/deafen/i);
    const camera = at(/camera/i);
    const share = at(/share screen/i);
    const settings = at(/voice settings/i);
    const hangUp = at(/disconnect/i);
    expect(dividersBetween(mic, deafen)).toBe(0);
    expect(dividersBetween(deafen, camera)).toBe(1);
    expect(dividersBetween(camera, share)).toBe(0);
    expect(dividersBetween(share, settings)).toBe(1);
    expect(dividersBetween(settings, hangUp)).toBe(1);
  });

  it('toggles keep fixed names and report their state with aria-pressed', () => {
    renderWithProviders(<VoiceBottomBar />);
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Deafen' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Share screen' })).toHaveAttribute('aria-pressed', 'false');
    const camera = screen.getByRole('button', { name: 'Camera' });
    expect(camera).toHaveAttribute('aria-pressed', 'false');
    // The call-view button no longer uses a camera glyph
    expect(screen.queryByTestId('VideoCallIcon')).not.toBeInTheDocument();
  });

  it('keeps deafen on phone but moves settings into "more"', () => {
    vi.mocked(useResponsive).mockReturnValue({
      isMobile: true,
      isTablet: false,
      isDesktop: false,
      deviceType: 'phone',
    } as never);

    renderWithProviders(<VoiceBottomBar />);

    expect(screen.getByRole('button', { name: /deafen/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /voice settings/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /more voice options/i })).toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: /open call view/i })).toBeInTheDocument();
  });

  it('hides "Show Video Tiles" button when tiles are already shown', () => {
    voiceState = { ...defaultVoiceState, showVideoTiles: true };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);

    renderWithProviders(<VoiceBottomBar />);

    expect(screen.queryByRole('button', { name: /open call view/i })).not.toBeInTheDocument();
  });

  it('"Show Video Tiles" button reveals (show + un-collapse) rather than just showing', async () => {
    voiceState = { ...defaultVoiceState, showVideoTiles: false };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);

    const { user } = renderWithProviders(<VoiceBottomBar />);

    await user.click(screen.getByRole('button', { name: /open call view/i }));

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

    it('shows speakerphone button on mobile (in "more") when setSinkId is supported', async () => {
      vi.mocked(useResponsive).mockReturnValue({
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        deviceType: 'phone',
      } as never);
      enableSetSinkId();

      const { user } = renderWithProviders(<VoiceBottomBar />);
      // Phone: the speaker toggle lives in the "more" sheet, not the bar.
      expect(screen.queryByTestId('PhoneInTalkIcon')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /more voice options/i }));

      expect(await screen.findByTestId('PhoneInTalkIcon')).toBeInTheDocument();
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
      await user.click(screen.getByRole('button', { name: /more voice options/i }));

      const speakerButton = (await screen.findByTestId('PhoneInTalkIcon')).closest('button')!;
      await user.click(speakerButton);

      // Toggling to speaker should select the default device
      expect(mockActions.switchAudioOutputDevice).toHaveBeenCalledWith('default');
    });

    it('does not show speakerphone button when setSinkId is not supported', async () => {
      vi.mocked(useResponsive).mockReturnValue({
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        deviceType: 'phone',
      } as never);
      disableSetSinkId();

      const { user } = renderWithProviders(<VoiceBottomBar />);
      await user.click(screen.getByRole('button', { name: /more voice options/i }));
      await screen.findByRole('button', { name: /all settings/i });

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
  describe('phone layout: 4 primary controls + "more" sheet (Task 16)', () => {
    const phone = () =>
      vi.mocked(useResponsive).mockReturnValue({
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        deviceType: 'phone',
        shouldUseTouchUI: true,
      } as never);

    beforeEach(() => {
      platform.electron = false;
      voiceState = { ...defaultVoiceState };
      vi.mocked(useVoiceConnection).mockReturnValue({
        state: voiceState,
        actions: { ...mockActions, playSoundboard: vi.fn() },
      } as never);
    });

    it('renders exactly mic, deafen, camera, hang-up and "more" in the bar', () => {
      phone();
      renderWithProviders(<VoiceBottomBar />);

      const controls = screen.getByTestId('voice-bar-controls');
      const buttons = within(controls).getAllByRole('button');
      expect(buttons).toHaveLength(5);
      expect(within(controls).getByRole('button', { name: /^mute$/i })).toBeInTheDocument();
      expect(within(controls).getByRole('button', { name: /^deafen$/i })).toBeInTheDocument();
      expect(within(controls).getByRole('button', { name: /^camera$/i })).toBeInTheDocument();
      expect(within(controls).getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
      expect(within(controls).getByRole('button', { name: /more voice options/i })).toBeInTheDocument();
      // Secondary actions are not in the bar.
      expect(screen.queryByTestId('ScreenShareIcon')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /open soundboard/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /show video tiles/i })).not.toBeInTheDocument();
    });

    it('"more" holds screen share, show tiles, soundboard and settings', async () => {
      phone();
      const { user } = renderWithProviders(<VoiceBottomBar />);

      await user.click(screen.getByRole('button', { name: /more voice options/i }));

      const sheet = await screen.findByTestId('voice-more-sheet');
      expect(within(sheet).getByRole('button', { name: /share screen/i })).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: /open call view/i })).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: /open soundboard/i })).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: /voice & video settings/i })).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: /all settings/i })).toBeInTheDocument();
    });

    it('actions in "more" run and close the sheet', async () => {
      phone();
      const { user } = renderWithProviders(<VoiceBottomBar />);

      await user.click(screen.getByRole('button', { name: /more voice options/i }));
      const sheet = await screen.findByTestId('voice-more-sheet');
      await user.click(within(sheet).getByRole('button', { name: /open call view/i }));

      expect(mockActions.revealVideoTiles).toHaveBeenCalled();
      await vi.waitFor(() => expect(screen.queryByTestId('voice-more-sheet')).not.toBeInTheDocument());
    });

    it('shows capture replay in "more" while the replay buffer is active', async () => {
      phone();
      vi.mocked(useReplayBufferState).mockReturnValue({ isReplayBufferActive: true });
      const { user } = renderWithProviders(<VoiceBottomBar />);

      expect(within(screen.getByTestId('voice-bar-controls')).getAllByRole('button')).toHaveLength(5);
      await user.click(screen.getByRole('button', { name: /more voice options/i }));
      const sheet = await screen.findByTestId('voice-more-sheet');
      expect(within(sheet).getByRole('button', { name: /capture replay/i })).toBeInTheDocument();
    });

    it('desktop bar is unchanged: no "more", secondary actions inline', () => {
      renderWithProviders(<VoiceBottomBar />);

      expect(screen.queryByRole('button', { name: /more voice options/i })).not.toBeInTheDocument();
      expect(screen.getByTestId('ScreenShareIcon')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /open soundboard/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /voice settings/i })).toBeInTheDocument();
    });

    describe('with the real useResponsive', () => {
      function stubViewportWidth(width: number) {
        vi.stubGlobal(
          'matchMedia',
          vi.fn((query: string) => {
            const min = /min-width:\s*(\d+)px/.exec(query);
            const max = /max-width:\s*(\d+)px/.exec(query);
            const matches =
              (min || max) && !query.includes('pointer') && !query.includes('hover')
                ? (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
                : false;
            return {
              matches: !!matches,
              media: query,
              onchange: null,
              addListener: vi.fn(),
              removeListener: vi.fn(),
              addEventListener: vi.fn(),
              removeEventListener: vi.fn(),
              dispatchEvent: vi.fn(),
            };
          }),
        );
      }

      beforeEach(async () => {
        const actual = await vi.importActual<typeof import('../../hooks/useResponsive')>('../../hooks/useResponsive');
        vi.mocked(useResponsive).mockImplementation(actual.useResponsive);
      });

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      it('uses the phone bar at 320px in a browser', () => {
        stubViewportWidth(320);
        renderWithProviders(<VoiceBottomBar />);

        expect(screen.getByRole('button', { name: /more voice options/i })).toBeInTheDocument();
        expect(within(screen.getByTestId('voice-bar-controls')).getAllByRole('button')).toHaveLength(5);
      });

      it('keeps the desktop bar in a narrow Electron window', () => {
        platform.electron = true;
        stubViewportWidth(320);
        renderWithProviders(<VoiceBottomBar />);

        expect(screen.queryByRole('button', { name: /more voice options/i })).not.toBeInTheDocument();
        expect(screen.getByTestId('ScreenShareIcon')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /voice settings/i })).toBeInTheDocument();
      });
    });
  });

  describe('channel voice permissions', () => {
    const reason = 'Timed out — you can listen until 3:42 PM';
    const listenOnly = {
      canSpeak: false,
      canVideo: false,
      canShare: false,
      speakBlockedReason: reason,
      videoBlockedReason: reason,
      shareBlockedReason: reason,
    };

    it('timed out: mic, camera and share are disabled with the reason', () => {
      vi.mocked(useVoicePublishPermissions).mockReturnValue(listenOnly);
      vi.mocked(useLocalMediaState).mockReturnValue({
        isCameraEnabled: false,
        isMicrophoneEnabled: false,
        isScreenShareEnabled: false,
        audioTrack: undefined,
        videoTrack: undefined,
      });
      renderWithProviders(<VoiceBottomBar />);

      const blocked = ['Mute', 'Camera', 'Share screen'].map((name) => screen.getByRole('button', { name }));
      blocked.forEach((button) => {
        expect(button).toBeDisabled();
        expect(button).toHaveAccessibleDescription(reason);
      });
      // Deafen (listening) is untouched
      expect(screen.getByRole('button', { name: /deafen/i })).toBeEnabled();
    });

    it('mic only: camera and share disabled with their own tooltips, mic works', () => {
      vi.mocked(useVoicePublishPermissions).mockReturnValue({
        ...allowedPublish,
        canVideo: false,
        canShare: false,
      });
      renderWithProviders(<VoiceBottomBar />);

      const camera = screen.getByRole('button', { name: 'Camera' });
      expect(camera).toBeDisabled();
      expect(camera).toHaveAccessibleDescription("You can't use video in this channel");
      const share = screen.getByRole('button', { name: 'Share screen' });
      expect(share).toBeDisabled();
      expect(share).toHaveAccessibleDescription("You can't share your screen in this channel");
      fireEvent.click(screen.getByRole('button', { name: /^mute$/i }));
      expect(mockActions.toggleMute).toHaveBeenCalled();
    });

    it('a live camera can still be turned off after losing VIDEO', () => {
      vi.mocked(useVoicePublishPermissions).mockReturnValue({ ...allowedPublish, canVideo: false });
      vi.mocked(useLocalMediaState).mockReturnValue({
        isCameraEnabled: true,
        isMicrophoneEnabled: true,
        isScreenShareEnabled: false,
        audioTrack: undefined,
        videoTrack: undefined,
      });
      renderWithProviders(<VoiceBottomBar />);

      const camera = screen.getByRole('button', { name: /^camera$/i });
      expect(camera).toBeEnabled();
      fireEvent.click(camera);
      expect(mockActions.toggleVideo).toHaveBeenCalled();
    });

    it('passes canSpeak to push-to-talk so PTT presses are ignored', () => {
      vi.mocked(useVoicePublishPermissions).mockReturnValue(listenOnly);
      renderWithProviders(<VoiceBottomBar />);
      expect(usePushToTalk).toHaveBeenCalledWith({ canSpeak: false });
    });
  });
});
