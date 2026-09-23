import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import VideoTile from '../../components/Voice/VideoTile';
import type { VideoTileProps } from '../../components/Voice/VideoTile';
import { generateTheme } from '../../theme/themeConfig';

vi.mock('../../components/Common/UserAvatar', () => ({
  default: ({ size }: { size?: string }) => (
    <div data-testid="avatar" data-size={size} />
  ),
}));

vi.mock('../../components/Voice/ScreenShareVolumeControl', () => ({
  default: () => <div data-testid="volume-control" />,
}));

// Controllable speaking state from the shared SpeakingContext
const mockIsSpeaking = vi.fn(() => false);
vi.mock('../../hooks/useSpeaking', () => ({
  useSpeaking: () => ({ speakingMap: new Map(), isSpeaking: mockIsSpeaking }),
}));

// jsdom doesn't implement HTMLMediaElement.play() — stub it to return a resolved promise
beforeAll(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});

function createMockTrackPublication(source: string, isMuted = false) {
  return {
    source,
    isMuted,
    track: { attach: vi.fn(), detach: vi.fn() },
  };
}

function createMockParticipant(identity: string) {
  return {
    identity,
    name: identity,
    audioTrackPublications: new Map(),
  };
}

function renderTile(overrides: Partial<VideoTileProps> = {}) {
  const props = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    participant: createMockParticipant('RemoteUser') as any,
    isLocal: false,
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderWithProviders(<VideoTile {...(props as any)} />);
}

describe('VideoTile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks does not undo mockReturnValue — reset explicitly
    mockIsSpeaking.mockReset();
    mockIsSpeaking.mockReturnValue(false);
  });

  it('renders no pin or fullscreen buttons (#320)', () => {
    renderTile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      videoTrack: createMockTrackPublication('camera') as any,
      onToggleFullscreen: vi.fn(),
    });

    expect(screen.queryByTestId('PushPinIcon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('PushPinOutlinedIcon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('CropFreeIcon')).not.toBeInTheDocument();
  });

  it('clicking the tile fires onToggleFullscreen', async () => {
    const onToggleFullscreen = vi.fn();
    const { user } = renderTile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      videoTrack: createMockTrackPublication('camera') as any,
      onToggleFullscreen,
    });

    await user.click(screen.getByText('RemoteUser'));

    expect(onToggleFullscreen).toHaveBeenCalledOnce();
  });

  it('renders the stop-watching button and it does not trigger fullscreen', async () => {
    const onToggleFullscreen = vi.fn();
    const onStopWatching = vi.fn();
    const { user } = renderTile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      videoTrack: createMockTrackPublication('camera') as any,
      onToggleFullscreen,
      onStopWatching,
    });

    // Action buttons are revealed on tile hover (Fade)
    const card = screen.getByText('RemoteUser').closest('[class*="MuiCard"]')!;
    fireEvent.mouseEnter(card);

    await user.click(screen.getByRole('button', { name: 'Stop watching' }));

    expect(onStopWatching).toHaveBeenCalledOnce();
    expect(onToggleFullscreen).not.toHaveBeenCalled();
  });

  it('renders the volume control only for remote screen share tiles', () => {
    const { unmount } = renderTile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      screenTrack: createMockTrackPublication('screen_share') as any,
      isLocal: false,
    });
    expect(screen.getByTestId('volume-control')).toBeInTheDocument();
    unmount();

    // Local screen share: no volume control
    const { unmount: unmount2 } = renderTile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      screenTrack: createMockTrackPublication('screen_share') as any,
      isLocal: true,
    });
    expect(screen.queryByTestId('volume-control')).not.toBeInTheDocument();
    unmount2();

    // Camera-only tile: no volume control
    renderTile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      videoTrack: createMockTrackPublication('camera') as any,
    });
    expect(screen.queryByTestId('volume-control')).not.toBeInTheDocument();
  });

  it('placeholder tile fires onWatch when clicked', async () => {
    const onWatch = vi.fn();
    const { user } = renderTile({
      isPlaceholder: true,
      placeholderType: 'screen',
      onWatch,
    });

    await user.click(screen.getByText('Click to watch'));

    expect(onWatch).toHaveBeenCalledOnce();
  });

  it('placeholder tile renders name, caption, and a fluid avatar (not fixed xlarge)', () => {
    renderTile({
      isPlaceholder: true,
      placeholderType: 'camera',
      isLocal: true,
      onWatch: vi.fn(),
    });

    expect(screen.getByText('RemoteUser')).toBeInTheDocument();
    expect(screen.getByText('Click to show')).toBeInTheDocument();
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-size', 'fluid');
  });

  it('no-video tile renders a fluid avatar', () => {
    renderTile({});

    expect(screen.getByTestId('avatar')).toHaveAttribute('data-size', 'fluid');
  });

  describe('speaking ring (Discord-style)', () => {
    const positive = generateTheme('dark', 'blue', 'balanced').palette.semantic.status.positive;

    function getCard(text: string | RegExp) {
      return screen.getByText(text).closest('[class*="MuiCard"]')!;
    }

    it('shows a green ring on a camera tile when the participant is speaking', () => {
      mockIsSpeaking.mockReturnValue(true);
      renderTile({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        videoTrack: createMockTrackPublication('camera') as any,
      });

      expect(mockIsSpeaking).toHaveBeenCalledWith('RemoteUser');
      expect(getCard(/RemoteUser/)).toHaveStyle({ borderColor: positive });
    });

    it('shows a green ring on an avatar-only tile when speaking', () => {
      mockIsSpeaking.mockReturnValue(true);
      renderTile({});

      expect(getCard(/RemoteUser/)).toHaveStyle({ borderColor: positive });
    });

    it('shows a green ring on a camera placeholder tile when speaking', () => {
      mockIsSpeaking.mockReturnValue(true);
      renderTile({ isPlaceholder: true, placeholderType: 'camera', onWatch: vi.fn() });

      expect(getCard('Click to watch')).toHaveStyle({ borderColor: positive });
    });

    it('never shows a ring on a screen-share tile, even when speaking', () => {
      mockIsSpeaking.mockReturnValue(true);
      renderTile({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        screenTrack: createMockTrackPublication('screen_share') as any,
      });

      expect(getCard(/RemoteUser/)).not.toHaveStyle({ borderColor: positive });
    });

    it('never shows a ring on a screen placeholder tile, even when speaking', () => {
      mockIsSpeaking.mockReturnValue(true);
      renderTile({ isPlaceholder: true, placeholderType: 'screen', onWatch: vi.fn() });

      expect(getCard('Click to watch')).not.toHaveStyle({ borderColor: positive });
    });

    it('shows no ring on a camera tile when not speaking', () => {
      renderTile({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        videoTrack: createMockTrackPublication('camera') as any,
      });

      expect(getCard(/RemoteUser/)).not.toHaveStyle({ borderColor: positive });
    });
  });

  it('keeps a long participant name on one line with an ellipsis (Review Focus #3)', () => {
    const name = 'Maximilianalexanderfeatherstonex';
    renderTile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      participant: { ...createMockParticipant('long-id'), name } as any,
    });
    const label = screen.getAllByText(new RegExp(name))[0];
    expect(label).toHaveClass('MuiTypography-noWrap');
  });
});
