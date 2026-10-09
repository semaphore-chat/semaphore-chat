/**
 * FloatCard docked in the message column (P15): above the composer, off the
 * member list / docked side panel, remembered per window-width bucket. The
 * window-based behaviour (no region) is covered by PersistentVideoOverlay.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { FloatCard } from '../../components/Voice/FloatCard';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { getCachedItem, setCachedItem } from '../../utils/storage';
import { DOCK_MARGIN, EDGE_PADDING, REGION_BOTTOM_LANE, defaultPlacement, type PipPlacement, type Rect } from '../../utils/pipPosition';

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
const mockRemoteParticipants = new Map<string, unknown>();
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
const mockVoiceState = { ...defaultVoiceState };
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

// The message-column dock region (normally registered by MessageContainer)
let mockRegion: Rect | null = null;
vi.mock('../../hooks/useFloatDockRegion', () => ({
  useFloatDockRegion: (enabled = true) => (enabled ? mockRegion : null),
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

const { useResponsive } = await import('../../hooks/useResponsive');
const { useVoiceConnection } = await import('../../hooks/useVoiceConnection');


const region: Rect = { left: 352, top: 56, width: 688, height: 600 };

function card() {
  return screen.getByTestId('float-card-body').parentElement as HTMLElement;
}

describe('FloatCard in the message column', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockRegion = region;
    mockSelection = { kind: 'avatar', participant: mockLocalParticipant };
    mockConnectionState = { ...defaultConnectionState, room: mockRoom };
    vi.mocked(useVoiceConnection).mockReturnValue({ state: mockConnectionState, actions: mockActions } as never);
    vi.mocked(useResponsive).mockReturnValue({
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isPortrait: false,
      deviceType: 'desktop',
    } as never);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  });

  it('docks bottom-right inside the column, above the composer, with a column-sized default', () => {
    renderWithProviders(<FloatCard />);
    const el = card();
    // 45% of 688 → the 320 floor, 4:3
    expect(el).toHaveStyle({ width: '320px', height: '240px' });
    expect(el).toHaveStyle({
      left: `${region.left + region.width - 320 - DOCK_MARGIN}px`,
      top: `${region.top + region.height - REGION_BOTTOM_LANE - 240 - DOCK_MARGIN}px`,
    });
  });

  it('ignores the window-based saved placement and uses the bucket key instead', () => {
    setCachedItem('semaphore_pip_placement', { ...defaultPlacement(), anchor: 'top-left' });
    setCachedItem('semaphore_pip_placement:chat:1280', {
      ...defaultPlacement(),
      anchor: 'top-left',
      size: { width: 360, height: 270 },
    });
    renderWithProviders(<FloatCard />);
    expect(card()).toHaveStyle({ left: `${region.left + DOCK_MARGIN}px`, top: `${region.top + DOCK_MARGIN}px`, width: '360px' });
  });

  it('saves a drag under the window-width bucket, not the window-based key', () => {
    renderWithProviders(<FloatCard />);
    const header = screen.getByText('General Voice').parentElement as HTMLElement;
    fireEvent.pointerDown(header, { pointerId: 1, clientX: 900, clientY: 400 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 600, clientY: 200 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 600, clientY: 200 });

    const saved = getCachedItem<PipPlacement>('semaphore_pip_placement:chat:1280');
    expect(saved).not.toBeNull();
    expect(saved!.docked).toBe(false);
    expect(getCachedItem('semaphore_pip_placement')).toBeNull();
  });

  it('shows the pill when the column is too small for the card, and the pill opens the call', () => {
    mockRegion = { ...region, width: 300 };
    renderWithProviders(<FloatCard />);
    const pill = screen.getByTestId('float-card-pill');
    act(() => {
      pill.click();
    });
    expect(mockActions.setPipCollapsed).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('keeps the window-based placement on touch layouts (no region)', () => {
    vi.mocked(useResponsive).mockReturnValue({
      isMobile: false,
      isTablet: true,
      isDesktop: false,
      isPortrait: false,
      deviceType: 'tablet',
    } as never);
    renderWithProviders(<FloatCard />);
    // Default window placement: 480x360
    expect(card()).toHaveStyle({ width: '480px', height: '360px' });
  });

  it('a temporary column shrink fits the card when rendering but never shrinks the saved size', () => {
    const wide: Rect = { ...region, width: 1100 };
    const saved = { ...defaultPlacement(), size: { width: 480, height: 360 } };
    setCachedItem('semaphore_pip_placement:chat:1280', saved);
    mockRegion = wide;
    const { rerender } = renderWithProviders(<FloatCard />);
    expect(card()).toHaveStyle({ width: '480px' });

    // The docked panel opens / the composer grows: the column gets narrower
    mockRegion = { ...region, width: 400 };
    rerender(<FloatCard />);
    expect(card()).toHaveStyle({ width: `${400 - EDGE_PADDING * 2}px` });
    expect(getCachedItem<PipPlacement>('semaphore_pip_placement:chat:1280')!.size).toEqual({ width: 480, height: 360 });

    // ...and closes again: back to the user's size
    mockRegion = wide;
    rerender(<FloatCard />);
    expect(card()).toHaveStyle({ width: '480px' });
  });

  it('first time in a bucket: starts from the window-based card\'s corner and size, fitted to the column', () => {
    setCachedItem('semaphore_pip_placement', {
      ...defaultPlacement(),
      anchor: 'top-left',
      docked: false,
      offset: { x: 300, y: 200 },
      size: { width: 400, height: 300 },
    });
    renderWithProviders(<FloatCard />);
    expect(card()).toHaveStyle({
      left: `${region.left + DOCK_MARGIN}px`,
      top: `${region.top + DOCK_MARGIN}px`,
      width: '400px',
    });
  });

  it('a forced pill opens the call even when the card was collapsed', () => {
    mockRegion = { ...region, width: 300 };
    mockConnectionState = { ...defaultConnectionState, pipCollapsed: true, room: mockRoom };
    vi.mocked(useVoiceConnection).mockReturnValue({ state: mockConnectionState, actions: mockActions } as never);
    renderWithProviders(<FloatCard />);
    act(() => {
      screen.getByTestId('float-card-pill').click();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/community/community-1/channel/channel-1');
    expect(mockActions.setPipCollapsed).not.toHaveBeenCalled();
  });
});

