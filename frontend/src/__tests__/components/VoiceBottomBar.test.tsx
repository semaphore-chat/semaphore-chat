import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { VoiceBottomBar } from '../../components/Voice/VoiceBottomBar';
import { VoiceSessionType, type VoiceState } from '../../contexts/VoiceContext';
import { VideoLayoutMode } from '../../types/videoLayout';

/**
 * VoiceBottomBar is now a thin, always-mounted shell that Suspense/lazy-loads
 * VoiceBottomBarContent (the real UI + all its livekit-touching hooks) only
 * once voice is connected — see PR-11 bundle splitting. Full behavioral
 * coverage of the bar's contents lives in VoiceBottomBarContent.test.tsx;
 * this file only covers the shell's gating + lazy-mount responsibility.
 */

const defaultVoiceState: VoiceState = {
  isConnected: false,
  isConnecting: false,
  connectionError: null,
  contextType: null,
  currentChannelId: null,
  channelName: null,
  communityId: null,
  isPrivate: null,
  createdAt: null,
  currentDmGroupId: null,
  dmGroupName: null,
  isDeafened: false,
  showVideoTiles: false,
  pipCollapsed: false,
  screenShareAudioFailed: false,
  selectedAudioInputId: null,
  selectedAudioOutputId: null,
  selectedVideoInputId: null,
  wasMutedBeforeDeafen: false,
  isServerMuted: false,
  watchingCameras: new Set<string>(),
  watchingScreenShares: new Set<string>(),
  hiddenLocalTiles: new Set<string>(),
  stageMounted: false,
  layoutMode: VideoLayoutMode.Grid,
  pinnedTileId: null,
  spotlightTileId: null,
};

let voiceState = { ...defaultVoiceState };

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: vi.fn(() => ({
    state: voiceState,
    actions: {},
  })),
}));

vi.mock('../../components/Voice/VoiceBottomBarContent', () => ({
  default: () => <div data-testid="voice-bottom-bar-content">content</div>,
}));

const { useVoiceConnection } = await import('../../hooks/useVoiceConnection');

describe('VoiceBottomBar (shell)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceState = { ...defaultVoiceState };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: {},
    } as never);
  });

  it('returns null when not connected', () => {
    const { container } = renderWithProviders(<VoiceBottomBar />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when connected but no channel or DM', () => {
    voiceState = { ...defaultVoiceState, isConnected: true, currentChannelId: null, currentDmGroupId: null };
    vi.mocked(useVoiceConnection).mockReturnValue({ state: voiceState, actions: {} } as never);

    const { container } = renderWithProviders(<VoiceBottomBar />);
    expect(container.innerHTML).toBe('');
  });

  it('lazily mounts the content component once connected to a channel', async () => {
    voiceState = {
      ...defaultVoiceState,
      isConnected: true,
      contextType: VoiceSessionType.Channel,
      currentChannelId: 'ch-1',
    };
    vi.mocked(useVoiceConnection).mockReturnValue({ state: voiceState, actions: {} } as never);

    renderWithProviders(<VoiceBottomBar />);

    expect(await screen.findByTestId('voice-bottom-bar-content')).toBeInTheDocument();
  });

  it('lazily mounts the content component once connected to a DM', async () => {
    voiceState = {
      ...defaultVoiceState,
      isConnected: true,
      contextType: VoiceSessionType.Dm,
      currentDmGroupId: 'dm-1',
    };
    vi.mocked(useVoiceConnection).mockReturnValue({ state: voiceState, actions: {} } as never);

    renderWithProviders(<VoiceBottomBar />);

    expect(await screen.findByTestId('voice-bottom-bar-content')).toBeInTheDocument();
  });
});
