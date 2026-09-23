import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { PersistentVideoOverlay } from '../../components/Voice/PersistentVideoOverlay';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { getCachedItem, setCachedItem } from '../../utils/storage';
import { toAbsolute, defaultPlacement, dockZoneRects, EDGE_PADDING, type PipPlacement } from '../../utils/pipPosition';
import { VOICE_BAR_HEIGHT } from '../../constants/layout';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// --- Mock actions ---
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

// --- Mock room ---
const mockLocalParticipant = { identity: 'local-user', name: 'Local User' };
let mockRemoteParticipants = new Map<string, unknown>();
const mockRoom = {
  localParticipant: mockLocalParticipant,
  get remoteParticipants() {
    return mockRemoteParticipants;
  },
};

// State backing useVoice() — the gate fields PersistentVideoOverlay itself reads.
const defaultVoiceState = {
  isConnected: true,
  channelName: 'General Voice',
  contextType: 'channel' as const,
  showVideoTiles: true,
  stageMounted: false,
  dmGroupName: null,
};
let mockVoiceState = { ...defaultVoiceState };
const mockDispatch = vi.fn();

vi.mock('../../contexts/VoiceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/VoiceContext')>();
  return {
    ...actual,
    useVoice: vi.fn(() => mockVoiceState),
    useVoiceDispatch: vi.fn(() => ({ dispatch: mockDispatch })),
  };
});

// State backing useVoiceConnection() — what FloatCard actually consumes.
const defaultConnectionState: {
  isConnected: boolean;
  contextType: VoiceSessionType;
  communityId: string | null;
  currentChannelId: string | null;
  channelName: string | null;
  currentDmGroupId: string | null;
  dmGroupName: string | null;
  stageMounted: boolean;
  pipCollapsed: boolean;
  isServerMuted: boolean;
  room: typeof mockRoom;
} = {
  isConnected: true,
  contextType: VoiceSessionType.Channel,
  communityId: 'community-1',
  currentChannelId: 'channel-1',
  channelName: 'General Voice',
  currentDmGroupId: null,
  dmGroupName: null,
  stageMounted: false,
  pipCollapsed: false,
  isServerMuted: false,
  room: mockRoom,
};
let mockConnectionState = { ...defaultConnectionState };

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: vi.fn(() => ({
    state: mockConnectionState,
    actions: mockActions,
  })),
}));

vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: vi.fn(() => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    isPortrait: false,
    deviceType: 'desktop',
  })),
}));

vi.mock('../../hooks/useLocalMediaState', () => ({
  useLocalMediaState: vi.fn(() => ({
    isCameraEnabled: false,
    isMicrophoneEnabled: true,
    isScreenShareEnabled: false,
  })),
}));

vi.mock('../../contexts/ReplayBufferContext', () => ({
  useReplayBufferState: vi.fn(() => ({ isReplayBufferActive: false })),
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

// Selection defaults to the avatar fallback — camera/screen kinds are
// exercised indirectly through useFloatTileSelection.test.ts's pure-function
// coverage; here we only need FloatCard's own click/control/badge wiring.
let mockSelection: unknown = { kind: 'avatar', participant: mockLocalParticipant };
vi.mock('../../hooks/useFloatTileSelection', () => ({
  useFloatTileSelection: vi.fn(() => mockSelection),
}));

// Mock VideoTiles to avoid complex setup (mobile branch)
vi.mock('../../components/Voice/VideoTiles', () => ({
  VideoTiles: () => <div data-testid="video-tiles">Video Tiles</div>,
}));

vi.mock('../../components/Voice/VideoTile', () => ({
  default: ({ participant, videoTrack, screenTrack, isLocal }: {
    participant?: { identity: string };
    videoTrack?: unknown;
    screenTrack?: unknown;
    isLocal?: boolean;
  }) => (
    <div
      data-testid="video-tile"
      data-identity={participant?.identity}
      data-kind={videoTrack ? 'camera' : screenTrack ? 'screen' : 'none'}
      data-local={isLocal ? 'true' : 'false'}
    />
  ),
}));

vi.mock('../../components/Common/UserAvatar', () => ({
  default: ({ userId }: { userId?: string }) => <div data-testid="user-avatar" data-user-id={userId} />,
}));

const { useVoice } = await import('../../contexts/VoiceContext');
const { useResponsive } = await import('../../hooks/useResponsive');
const { useVoiceConnection } = await import('../../hooks/useVoiceConnection');
const { usePushToTalk } = await import('../../hooks/usePushToTalk');

describe('PersistentVideoOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockRemoteParticipants = new Map();
    mockSelection = { kind: 'avatar', participant: mockLocalParticipant };
    mockVoiceState = { ...defaultVoiceState };
    mockConnectionState = { ...defaultConnectionState, room: mockRoom };
    vi.mocked(useVoice).mockReturnValue(mockVoiceState as never);
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: mockConnectionState,
      actions: mockActions,
    } as never);
    vi.mocked(usePushToTalk).mockReturnValue({
      isActive: false,
      isKeyHeld: false,
      currentKeyDisplay: 'Space',
      inputMode: 'voice_activity',
      pttPress: vi.fn(),
      pttRelease: vi.fn(),
    } as never);
    vi.mocked(useResponsive).mockReturnValue({
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isPortrait: false,
      deviceType: 'desktop',
    } as never);
  });

  it('returns null when not connected', () => {
    mockVoiceState = { ...defaultVoiceState, isConnected: false };
    vi.mocked(useVoice).mockReturnValue(mockVoiceState as never);

    const { container } = renderWithProviders(<PersistentVideoOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when video tiles are hidden', () => {
    mockVoiceState = { ...defaultVoiceState, showVideoTiles: false };
    vi.mocked(useVoice).mockReturnValue(mockVoiceState as never);

    const { container } = renderWithProviders(<PersistentVideoOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null on desktop when the embedded stage is mounted', () => {
    mockVoiceState = { ...defaultVoiceState, stageMounted: true };
    vi.mocked(useVoice).mockReturnValue(mockVoiceState as never);

    const { container } = renderWithProviders(<PersistentVideoOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('renders mobile full-screen overlay on mobile', () => {
    vi.mocked(useResponsive).mockReturnValue({
      isMobile: true,
      isTablet: false,
      isDesktop: false,
      isPortrait: true,
      deviceType: 'phone',
    } as never);

    renderWithProviders(<PersistentVideoOverlay />);

    // Mobile overlay should render VideoTiles
    expect(screen.getByTestId('video-tiles')).toBeInTheDocument();
    // Mobile overlay should NOT have the float card's drag/minimize chrome
    expect(screen.queryByTestId('DragIndicatorIcon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('MinimizeIcon')).not.toBeInTheDocument();
  });

  it('mobile overlay has a close button that hides video tiles', async () => {
    vi.mocked(useResponsive).mockReturnValue({
      isMobile: true,
      isTablet: false,
      isDesktop: false,
      isPortrait: true,
      deviceType: 'phone',
    } as never);

    const { user } = renderWithProviders(<PersistentVideoOverlay />);

    const closeIcon = screen.getByTestId('CloseIcon');
    const closeButton = closeIcon.closest('button')!;
    await user.click(closeButton);

    expect(mockActions.setShowVideoTiles).toHaveBeenCalledWith(false);
  });

  it('still renders the mobile overlay when the embedded stage is mounted', () => {
    mockVoiceState = { ...defaultVoiceState, stageMounted: true };
    vi.mocked(useVoice).mockReturnValue(mockVoiceState as never);
    vi.mocked(useResponsive).mockReturnValue({
      isMobile: true,
      isTablet: false,
      isDesktop: false,
      isPortrait: true,
      deviceType: 'phone',
    } as never);

    renderWithProviders(<PersistentVideoOverlay />);

    expect(screen.getByTestId('video-tiles')).toBeInTheDocument();
  });

  describe('desktop float card', () => {
    it('renders the drag header with the channel name', () => {
      renderWithProviders(<PersistentVideoOverlay />);

      expect(screen.getByTestId('DragIndicatorIcon')).toBeInTheDocument();
      expect(screen.getByText('General Voice')).toBeInTheDocument();
    });

    it('falls back to defaultPlacement() when the persisted placement has a NaN offset, instead of rendering off-screen at NaN', () => {
      // typeof NaN === 'number', so a naive numeric type check on a corrupted
      // localStorage record would pass and render the card at `left: NaN`
      // (invisible, with no way for the user to recover it).
      setCachedItem('semaphore_pip_placement', {
        anchor: 'bottom-right',
        offset: { x: NaN, y: 0 },
        size: { width: 480, height: 360 },
        docked: false,
        collapsed: false,
      });

      renderWithProviders(<PersistentVideoOverlay />);

      const vp = { width: window.innerWidth, height: window.innerHeight, bottomInset: VOICE_BAR_HEIGHT };
      const expectedAbs = toAbsolute(defaultPlacement(), vp);
      const dragGrabOffset = { x: 5, y: 5 };
      const pointerDownAt = { x: expectedAbs.x + dragGrabOffset.x, y: expectedAbs.y + dragGrabOffset.y };
      const pointerMoveTo = { x: pointerDownAt.x + 20, y: pointerDownAt.y + 20 };

      // Drag from where defaultPlacement() would put the header and confirm
      // the drop lands at a finite position — if the corrupted NaN record
      // had been used instead, every position computed from it (including
      // this drag) would also come out NaN.
      const header = screen.getByTestId('DragIndicatorIcon');
      fireEvent.pointerDown(header, { pointerId: 1, clientX: pointerDownAt.x, clientY: pointerDownAt.y });
      act(() => {
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: pointerMoveTo.x, clientY: pointerMoveTo.y }));
      });
      act(() => {
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: pointerMoveTo.x, clientY: pointerMoveTo.y }));
      });

      const placement = getCachedItem<PipPlacement>('semaphore_pip_placement');
      expect(Number.isFinite(placement!.offset.x)).toBe(true);
      expect(Number.isFinite(placement!.offset.y)).toBe(true);
    });

    it('no longer has a close button (replaced by collapse-to-pill)', () => {
      renderWithProviders(<PersistentVideoOverlay />);

      expect(screen.queryByTestId('CloseIcon')).not.toBeInTheDocument();
      expect(screen.getByTestId('MinimizeIcon')).toBeInTheDocument();
    });

    it('clicking the card body navigates to the channel stage path', async () => {
      const { user } = renderWithProviders(<PersistentVideoOverlay />);

      await user.click(screen.getByTestId('float-card-body'));

      expect(mockNavigate).toHaveBeenCalledWith('/community/community-1/channel/channel-1');
    });

    it('clicking the card body navigates to the DM deep link for DM sessions', async () => {
      mockConnectionState = {
        ...defaultConnectionState,
        contextType: VoiceSessionType.Dm,
        communityId: null,
        currentChannelId: null,
        channelName: null,
        currentDmGroupId: 'dm-group-1',
        dmGroupName: 'Friends',
        room: mockRoom,
      };
      vi.mocked(useVoiceConnection).mockReturnValue({
        state: mockConnectionState,
        actions: mockActions,
      } as never);

      const { user } = renderWithProviders(<PersistentVideoOverlay />);

      await user.click(screen.getByTestId('float-card-body'));

      expect(mockNavigate).toHaveBeenCalledWith('/direct-messages?group=dm-group-1');
    });

    it('clicks on the control strip do not navigate', async () => {
      const { user } = renderWithProviders(<PersistentVideoOverlay />);

      const micIcon = screen.getByTestId('MicIcon');
      await user.click(micIcon.closest('button')!);

      expect(mockActions.toggleMute).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('camera control in the strip toggles the camera without navigating', async () => {
      const { user } = renderWithProviders(<PersistentVideoOverlay />);

      const camIcon = screen.getByTestId('VideocamOffIcon');
      await user.click(camIcon.closest('button')!);

      expect(mockActions.toggleVideo).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('shows a participant-count badge on the collapsed pill', () => {
      mockRemoteParticipants = new Map([
        ['remote-1', { identity: 'remote-1' }],
        ['remote-2', { identity: 'remote-2' }],
      ]);
      mockConnectionState = { ...defaultConnectionState, pipCollapsed: true };
      vi.mocked(useVoiceConnection).mockReturnValue({
        state: mockConnectionState,
        actions: mockActions,
      } as never);

      renderWithProviders(<PersistentVideoOverlay />);

      expect(screen.getByTestId('float-card-pill')).toBeInTheDocument();
      // 2 remote participants + local participant
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('collapse control dispatches SetPipCollapsed(true); context flipping it shows the pill', async () => {
      const { user, rerender } = renderWithProviders(<PersistentVideoOverlay />);

      expect(screen.queryByTestId('float-card-pill')).not.toBeInTheDocument();

      const minimizeIcon = screen.getByTestId('MinimizeIcon');
      await user.click(minimizeIcon.closest('button')!);

      expect(mockActions.setPipCollapsed).toHaveBeenCalledWith(true);

      // Collapsed/expanded is driven by context (state.pipCollapsed), not local
      // component state — simulate the context updating in response to the dispatch.
      // (Persisting collapsed to semaphore_pip_placement is VoiceProvider's job —
      // see contexts/VoiceContext.test.tsx — not exercised by this mocked-context
      // test, which isolates FloatCard's own rendering/dispatch wiring.)
      mockConnectionState = { ...mockConnectionState, pipCollapsed: true };
      vi.mocked(useVoiceConnection).mockReturnValue({
        state: mockConnectionState,
        actions: mockActions,
      } as never);
      rerender(<PersistentVideoOverlay />);

      expect(screen.getByTestId('float-card-pill')).toBeInTheDocument();
    });

    it('renders VideoTile for a camera selection', () => {
      const camParticipant = { identity: 'remote-1', name: 'RemoteUser' };
      mockSelection = { kind: 'camera', participant: camParticipant, publication: { source: 'camera' } };

      renderWithProviders(<PersistentVideoOverlay />);

      const tile = screen.getByTestId('video-tile');
      expect(tile).toHaveAttribute('data-identity', 'remote-1');
      expect(tile).toHaveAttribute('data-kind', 'camera');
      expect(tile).toHaveAttribute('data-local', 'false');
    });

    it('renders VideoTile for a screen-share selection', () => {
      const sharer = { identity: 'remote-2', name: 'Sharer' };
      mockSelection = { kind: 'screen', participant: sharer, publication: { source: 'screen_share' } };

      renderWithProviders(<PersistentVideoOverlay />);

      const tile = screen.getByTestId('video-tile');
      expect(tile).toHaveAttribute('data-identity', 'remote-2');
      expect(tile).toHaveAttribute('data-kind', 'screen');
    });

    it('clicking the pill dispatches SetPipCollapsed(false); context flipping it restores the full card', async () => {
      mockConnectionState = { ...defaultConnectionState, pipCollapsed: true };
      vi.mocked(useVoiceConnection).mockReturnValue({
        state: mockConnectionState,
        actions: mockActions,
      } as never);

      const { user, rerender } = renderWithProviders(<PersistentVideoOverlay />);

      await user.click(screen.getByTestId('float-card-pill'));

      expect(mockActions.setPipCollapsed).toHaveBeenCalledWith(false);

      mockConnectionState = { ...mockConnectionState, pipCollapsed: false };
      vi.mocked(useVoiceConnection).mockReturnValue({
        state: mockConnectionState,
        actions: mockActions,
      } as never);
      rerender(<PersistentVideoOverlay />);

      expect(screen.queryByTestId('float-card-pill')).not.toBeInTheDocument();
      expect(screen.getByTestId('float-card-body')).toBeInTheDocument();
    });

    it('dragging the header into a dock zone persists a docked placement at that anchor', () => {
      renderWithProviders(<PersistentVideoOverlay />);

      const vp = { width: window.innerWidth, height: window.innerHeight, bottomInset: VOICE_BAR_HEIGHT };
      const startAbs = toAbsolute(defaultPlacement(), vp);
      const bottomLeftZone = dockZoneRects(vp).find((z) => z.anchor === 'bottom-left')!;
      const dropPoint = { x: bottomLeftZone.x + 10, y: bottomLeftZone.y + 10 };

      const header = screen.getByTestId('DragIndicatorIcon');
      fireEvent.pointerDown(header, { pointerId: 1, clientX: startAbs.x + 20, clientY: startAbs.y + 10 });
      act(() => {
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: dropPoint.x, clientY: dropPoint.y }));
      });
      act(() => {
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: dropPoint.x, clientY: dropPoint.y }));
      });

      const placement = getCachedItem<PipPlacement>('semaphore_pip_placement');
      expect(placement).toMatchObject({ anchor: 'bottom-left', docked: true, offset: { x: 0, y: 0 } });
    });

    it('dragging the header outside every dock zone persists the exact free drop position', () => {
      renderWithProviders(<PersistentVideoOverlay />);

      const vp = { width: window.innerWidth, height: window.innerHeight, bottomInset: VOICE_BAR_HEIGHT };
      const { size } = defaultPlacement();
      const startAbs = toAbsolute(defaultPlacement(), vp);
      const dragGrabOffset = { x: 20, y: 10 };
      const pointerDownAt = { x: startAbs.x + dragGrabOffset.x, y: startAbs.y + dragGrabOffset.y };
      // A drop point safely inside the reachable free-placement range (not
      // clamped, not in a corner dock zone), so the round trip through
      // fromAbsolute/toAbsolute is an identity.
      const maxX = vp.width - size.width - EDGE_PADDING;
      const maxY = vp.height - vp.bottomInset - size.height - EDGE_PADDING;
      const expectedDropPos = { x: Math.round(maxX / 2), y: Math.round(maxY / 2) };
      const pointerMoveTo = {
        x: expectedDropPos.x + dragGrabOffset.x,
        y: expectedDropPos.y + dragGrabOffset.y,
      };

      const header = screen.getByTestId('DragIndicatorIcon');
      fireEvent.pointerDown(header, { pointerId: 1, clientX: pointerDownAt.x, clientY: pointerDownAt.y });
      act(() => {
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: pointerMoveTo.x, clientY: pointerMoveTo.y }));
      });
      act(() => {
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: pointerMoveTo.x, clientY: pointerMoveTo.y }));
      });

      const placement = getCachedItem<PipPlacement>('semaphore_pip_placement');
      expect(placement?.docked).toBe(false);
      expect(toAbsolute(placement!, vp)).toEqual(expectedDropPos);
    });

    it('a plain click on the header (pointerdown+pointerup with no movement) does not dock and shows no dock zones', () => {
      renderWithProviders(<PersistentVideoOverlay />);

      const before = getCachedItem<PipPlacement>('semaphore_pip_placement');
      const vp = { width: window.innerWidth, height: window.innerHeight, bottomInset: VOICE_BAR_HEIGHT };
      // Pick a point that overlaps a corner dock zone, so a pre-threshold-fix
      // implementation would snap-dock on release.
      const zone = dockZoneRects(vp).find((z) => z.anchor === 'bottom-right')!;
      const clickAt = { x: zone.x + 10, y: zone.y + 10 };

      const header = screen.getByTestId('DragIndicatorIcon');
      fireEvent.pointerDown(header, { pointerId: 1, clientX: clickAt.x, clientY: clickAt.y });

      expect(screen.queryByTestId('dock-zone-bottom-right')).not.toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: clickAt.x, clientY: clickAt.y }));
      });

      expect(screen.queryByTestId('dock-zone-bottom-right')).not.toBeInTheDocument();
      expect(getCachedItem<PipPlacement>('semaphore_pip_placement')).toEqual(before);
    });

    it('movement below the drag threshold does not start a drag, but continuing past it does', () => {
      renderWithProviders(<PersistentVideoOverlay />);

      const header = screen.getByTestId('DragIndicatorIcon');
      fireEvent.pointerDown(header, { pointerId: 1, clientX: 500, clientY: 500 });

      act(() => {
        // ~2.2px of movement — below the 5px threshold.
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 502, clientY: 501 }));
      });
      expect(screen.queryByTestId('dock-zone-bottom-right')).not.toBeInTheDocument();

      act(() => {
        // Now comfortably past the threshold.
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 530, clientY: 530 }));
      });
      expect(screen.getByTestId('dock-zone-bottom-right')).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 530, clientY: 530 }));
      });
    });

    it('does not render dock zones before any drag gesture starts', () => {
      renderWithProviders(<PersistentVideoOverlay />);

      expect(screen.queryByTestId('dock-zone-bottom-right')).not.toBeInTheDocument();
    });

    it('keeps dock zones mounted through pointerup so the exit fade can play, instead of vanishing instantly', () => {
      renderWithProviders(<PersistentVideoOverlay />);

      const header = screen.getByTestId('DragIndicatorIcon');
      fireEvent.pointerDown(header, { pointerId: 1, clientX: 500, clientY: 500 });
      act(() => {
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 530, clientY: 530 }));
      });
      expect(screen.getByTestId('dock-zone-bottom-right')).toBeInTheDocument();

      act(() => {
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 530, clientY: 530 }));
      });

      // Fade's unmountOnExit keeps the node mounted until the exit
      // transition finishes — it must still be present right after pointerup,
      // not torn out of the DOM synchronously.
      expect(screen.getByTestId('dock-zone-bottom-right')).toBeInTheDocument();
    });

    it('float card mic button does not toggle mute while push-to-talk is active', async () => {
      vi.mocked(usePushToTalk).mockReturnValue({
        isActive: true,
        isKeyHeld: false,
        currentKeyDisplay: 'Space',
        inputMode: 'push_to_talk',
        pttPress: vi.fn(),
        pttRelease: vi.fn(),
      } as never);

      const { user } = renderWithProviders(<PersistentVideoOverlay />);

      const micIcon = screen.getByTestId('MicIcon');
      await user.click(micIcon.closest('button')!);

      expect(mockActions.toggleMute).not.toHaveBeenCalled();
    });

    it('float card mic button does not toggle mute while server-muted', async () => {
      mockConnectionState = { ...defaultConnectionState, isServerMuted: true };
      vi.mocked(useVoiceConnection).mockReturnValue({
        state: mockConnectionState,
        actions: mockActions,
      } as never);

      const { user } = renderWithProviders(<PersistentVideoOverlay />);

      const micIcon = screen.getByTestId('MicIcon');
      await user.click(micIcon.closest('button')!);

      expect(mockActions.toggleMute).not.toHaveBeenCalled();
    });
  });
});
