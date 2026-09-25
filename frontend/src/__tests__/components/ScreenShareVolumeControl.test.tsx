import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScreenShareVolumeControl from '../../components/Voice/ScreenShareVolumeControl';
import { audioBoostManager } from '../../features/voice/audioBoostManager';

let mockIsDeafened = false;
let mockShouldUseTouchUI = false;

vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: vi.fn(() => ({ shouldUseTouchUI: mockShouldUseTouchUI })),
}));

vi.mock('livekit-client', () => ({
  Track: {
    Source: {
      ScreenShareAudio: 'screen_share_audio',
    },
  },
}));

vi.mock('../../contexts/VoiceContext', () => ({
  useVoice: vi.fn(() => ({ isDeafened: mockIsDeafened })),
}));

vi.mock('../../features/voice/audioBoostManager', () => ({
  boostKey: (identity: string, source: string) => `${identity}:${source}`,
  audioBoostManager: {
    applyVolume: vi.fn(),
    setDeafened: vi.fn(),
    removeEntry: vi.fn(),
    removeForParticipant: vi.fn(),
    reset: vi.fn(),
    hasBoost: vi.fn(() => false),
  },
}));

function createMockParticipant(identity: string, hasScreenShareAudio = true) {
  const setVolume = vi.fn();
  const track = {
    setVolume,
    mediaStream: null,
  };
  const publications = new Map();
  if (hasScreenShareAudio) {
    publications.set('screen_share_audio', {
      track,
      source: 'screen_share_audio',
    });
  }
  return {
    participant: {
      identity,
      audioTrackPublications: publications,
    },
    setVolume,
    track,
  };
}

// Mock MUI theme
vi.mock('@mui/material/styles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material/styles')>();
  return {
    ...actual,
    useTheme: () => ({
      palette: {
        background: { paper: '#1e1e1e' },
        common: { white: '#fff' },
      },
    }),
    alpha: (color: string, opacity: number) => `${color}/${opacity}`,
  };
});

function renderControl(identity = 'user-1') {
  const mock = createMockParticipant(identity);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = render(<ScreenShareVolumeControl participant={mock.participant as any} />);
  return { ...mock, ...result };
}

function getMuteButton() {
  return screen.getByRole('button', { name: /mute screenshare/i });
}

/** Hover the control's container so the slider expands */
async function hoverControl(user: ReturnType<typeof userEvent.setup>) {
  await user.hover(getMuteButton());
}

describe('ScreenShareVolumeControl', () => {
  let localStorageGetSpy: MockInstance<Storage['getItem']>;
  let localStorageSetSpy: MockInstance<Storage['setItem']>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeafened = false;
    mockShouldUseTouchUI = false;
    localStorageGetSpy = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    localStorageSetSpy = vi.spyOn(Storage.prototype, 'setItem');
  });

  afterEach(() => {
    localStorageGetSpy.mockRestore();
    localStorageSetSpy.mockRestore();
  });

  it('renders the mute icon button with aria-label', () => {
    renderControl();

    expect(getMuteButton()).toBeInTheDocument();
    expect(getMuteButton()).toHaveAccessibleName('Mute screenshare');
  });

  it('hides the slider until hovered', async () => {
    const user = userEvent.setup();
    renderControl();

    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    await hoverControl(user);
    expect(screen.getByRole('slider')).toBeInTheDocument();

    await user.unhover(getMuteButton());
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('reads initial volume from localStorage', () => {
    localStorageGetSpy.mockReturnValue('0.5');
    renderControl();

    expect(localStorageGetSpy).toHaveBeenCalledWith('voiceScreenShareVolume:user-1');
  });

  it('rejects invalid localStorage values and defaults to 100%', () => {
    localStorageGetSpy.mockReturnValue('not-a-number');
    renderControl();

    // Invalid stored value is rejected, so component defaults to 100%
    expect(screen.getByTestId('VolumeUpIcon')).toBeInTheDocument();
  });

  it('writes correct localStorage key on volume change', async () => {
    const user = userEvent.setup();
    renderControl();

    await hoverControl(user);
    fireEvent.change(screen.getByRole('slider'), { target: { value: 50 } });

    const setCalls = localStorageSetSpy.mock.calls.filter(
      ([key]) => key === 'voiceScreenShareVolume:user-1',
    );
    expect(setCalls.length).toBeGreaterThan(0);
  });

  it('applies volume through the boost manager with the canonical track key', async () => {
    const user = userEvent.setup();
    const { track } = renderControl();

    await hoverControl(user);
    fireEvent.change(screen.getByRole('slider'), { target: { value: 75 } });

    expect(audioBoostManager.applyVolume).toHaveBeenCalledWith(
      track,
      'user-1:screen_share_audio',
      75,
    );
  });

  it('mutes on icon click: applies volume 0 and persists it', async () => {
    const user = userEvent.setup();
    const { track } = renderControl();

    await user.click(getMuteButton());

    expect(audioBoostManager.applyVolume).toHaveBeenCalledWith(
      track,
      'user-1:screen_share_audio',
      0,
    );
    expect(localStorageSetSpy).toHaveBeenCalledWith('voiceScreenShareVolume:user-1', '0');
    expect(screen.getByTestId('VolumeOffIcon')).toBeInTheDocument();
    expect(getMuteButton()).toHaveAccessibleName('Unmute screenshare');
  });

  it('restores the previous volume on second click', async () => {
    localStorageGetSpy.mockReturnValue('0.75');
    const user = userEvent.setup();
    const { track } = renderControl();

    await user.click(getMuteButton()); // mute (was 75)
    await user.click(getMuteButton()); // unmute

    expect(audioBoostManager.applyVolume).toHaveBeenLastCalledWith(
      track,
      'user-1:screen_share_audio',
      75,
    );
    expect(localStorageSetSpy).toHaveBeenCalledWith('voiceScreenShareVolume:user-1', '0.75');
  });

  it('unmutes to 100% when mounted already muted (no previous volume)', async () => {
    localStorageGetSpy.mockReturnValue('0');
    const user = userEvent.setup();
    const { track } = renderControl();

    expect(screen.getByTestId('VolumeOffIcon')).toBeInTheDocument();

    await user.click(getMuteButton());

    expect(audioBoostManager.applyVolume).toHaveBeenCalledWith(
      track,
      'user-1:screen_share_audio',
      100,
    );
  });

  it('dragging the slider to 0 shows the muted icon', async () => {
    const user = userEvent.setup();
    renderControl();

    await hoverControl(user);
    fireEvent.change(screen.getByRole('slider'), { target: { value: 0 } });

    expect(screen.getByTestId('VolumeOffIcon')).toBeInTheDocument();
  });

  it('unmuting after sliding to 0 restores the volume from before the slide', async () => {
    localStorageGetSpy.mockReturnValue('0.75');
    const user = userEvent.setup();
    const { track } = renderControl();

    await hoverControl(user);
    fireEvent.change(screen.getByRole('slider'), { target: { value: 0 } });
    expect(screen.getByTestId('VolumeOffIcon')).toBeInTheDocument();

    await user.click(getMuteButton());

    expect(audioBoostManager.applyVolume).toHaveBeenLastCalledWith(
      track,
      'user-1:screen_share_audio',
      75,
    );
  });

  it('expands the slider on keyboard focus', async () => {
    const user = userEvent.setup();
    renderControl();

    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    await user.tab(); // focus lands on the mute button
    expect(getMuteButton()).toHaveFocus();
    expect(screen.getByRole('slider')).toBeInTheDocument();

    await user.tab(); // focus leaves the control
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('does not change any volumes on unmount (boost must outlive the component)', async () => {
    const user = userEvent.setup();
    const { participant, setVolume } = createMockParticipant('user-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { unmount } = render(<ScreenShareVolumeControl participant={participant as any} />);

    await user.hover(getMuteButton());
    fireEvent.change(screen.getByRole('slider'), { target: { value: 150 } });

    vi.mocked(audioBoostManager.applyVolume).mockClear();
    vi.mocked(audioBoostManager.removeEntry).mockClear();
    setVolume.mockClear();

    unmount();

    expect(audioBoostManager.applyVolume).not.toHaveBeenCalled();
    expect(audioBoostManager.removeEntry).not.toHaveBeenCalled();
    expect(audioBoostManager.reset).not.toHaveBeenCalled();
    expect(setVolume).not.toHaveBeenCalled();
  });

  it('disables slider and mute button when deafened', () => {
    mockIsDeafened = true;
    const { track } = renderControl();

    expect(getMuteButton()).toBeDisabled();

    // userEvent.hover rejects disabled targets; enter the container directly
    const container = getMuteButton().closest('span')!.parentElement!;
    fireEvent.mouseEnter(container);
    const sliderRoot = screen.getByRole('slider').closest('.MuiSlider-root');
    expect(sliderRoot).toHaveClass('Mui-disabled');

    // Clicking the disabled button must not change volume
    fireEvent.click(getMuteButton());
    expect(audioBoostManager.applyVolume).not.toHaveBeenCalledWith(
      track,
      'user-1:screen_share_audio',
      0,
    );
  });

  it('does not propagate clicks to the parent tile', async () => {
    const onTileClick = vi.fn();
    const { participant } = createMockParticipant('user-1');
    const user = userEvent.setup();
    render(
      // Stands in for the clickable tile; presentation role: it is only a
      // click-capture surface for the propagation check.
      <div role="presentation" onClick={onTileClick}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ScreenShareVolumeControl participant={participant as any} />
      </div>,
    );

    await user.click(getMuteButton());

    expect(onTileClick).not.toHaveBeenCalled();
  });

  it('defaults to 100% when no stored volume exists', () => {
    localStorageGetSpy.mockReturnValue(null);
    renderControl();

    expect(screen.getByTestId('VolumeUpIcon')).toBeInTheDocument();
  });

  describe('touch UI', () => {
    beforeEach(() => {
      mockShouldUseTouchUI = true;
    });

    // On touch, the collapsed icon is relabelled "Screenshare volume" because
    // its tap opens the slider popover rather than toggling mute directly.
    function getVolumeButton() {
      return screen.getByRole('button', { name: /screenshare volume/i });
    }

    it('tapping the icon opens a popover with an always-visible slider', async () => {
      const user = userEvent.setup();
      renderControl();

      // No hover on touch → slider not rendered until the popover opens.
      expect(screen.queryByRole('slider')).not.toBeInTheDocument();

      await user.click(getVolumeButton());

      expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('keeps the mute toggle reachable inside the popover', async () => {
      const user = userEvent.setup();
      renderControl();

      // Open the popover, then use its mute button.
      await user.click(getVolumeButton());
      await user.click(screen.getByRole('button', { name: /mute screenshare/i }));

      // Muting applies a volume of 0.
      expect(audioBoostManager.applyVolume).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        0,
      );
    });

    it('does not toggle mute on the initial icon tap (opens popover instead)', async () => {
      const user = userEvent.setup();
      renderControl();

      await user.click(getVolumeButton());

      // Opening the popover must not mute the track.
      expect(audioBoostManager.applyVolume).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        0,
      );
    });
  });
});
