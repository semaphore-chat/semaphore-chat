import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { renderWithProviders } from '../test-utils';
import { VideoTiles } from '../../components/Voice/VideoTiles';
import { VoiceSessionType, VoiceActionType } from '../../contexts/VoiceContext';
import { VideoLayoutMode } from '../../types/videoLayout';

let mockWatchingCameras = new Set<string>();
let mockWatchingScreenShares = new Set<string>();

// layoutMode/pinnedTileId/spotlightTileId now live in VoiceContext's reducer
// (Task 5). Rather than statically mock them, this tiny external store mirrors
// the reducer's toggle semantics so dispatching from VideoTiles actually
// updates what useVoice() returns and re-renders the component — the same
// click-driven assertions the "layout modes and pinning" tests rely on.
let mockLayoutMode: VideoLayoutMode = VideoLayoutMode.Grid;
let mockPinnedTileId: string | null = null;
let mockSpotlightTileId: string | null = null;
type MockLayoutSnapshot = {
  layoutMode: VideoLayoutMode;
  pinnedTileId: string | null;
  spotlightTileId: string | null;
};
let mockLayoutSnapshot: MockLayoutSnapshot = {
  layoutMode: mockLayoutMode,
  pinnedTileId: mockPinnedTileId,
  spotlightTileId: mockSpotlightTileId,
};
const mockLayoutListeners = new Set<() => void>();

function mockCommitLayoutSnapshot() {
  mockLayoutSnapshot = {
    layoutMode: mockLayoutMode,
    pinnedTileId: mockPinnedTileId,
    spotlightTileId: mockSpotlightTileId,
  };
  mockLayoutListeners.forEach((listener) => listener());
}

function mockResetLayoutState() {
  mockLayoutMode = VideoLayoutMode.Grid;
  mockPinnedTileId = null;
  mockSpotlightTileId = null;
  mockCommitLayoutSnapshot();
}

function mockSubscribeLayoutState(listener: () => void) {
  mockLayoutListeners.add(listener);
  return () => mockLayoutListeners.delete(listener);
}

function mockGetLayoutSnapshot() {
  return mockLayoutSnapshot;
}

function mockDispatchLayoutAction(action: { type: string; payload?: unknown }) {
  switch (action.type) {
    case VoiceActionType.SetLayoutMode: {
      mockLayoutMode = action.payload as VideoLayoutMode;
      if (mockLayoutMode !== VideoLayoutMode.Spotlight) mockSpotlightTileId = null;
      break;
    }
    case VoiceActionType.TogglePinTile: {
      const id = action.payload as string;
      if (mockPinnedTileId === id) {
        mockPinnedTileId = null;
      } else {
        mockPinnedTileId = id;
        mockLayoutMode = VideoLayoutMode.Sidebar;
      }
      break;
    }
    case VoiceActionType.ToggleSpotlightTile: {
      const id = action.payload as string;
      if (mockLayoutMode === VideoLayoutMode.Spotlight && mockSpotlightTileId === id) {
        mockSpotlightTileId = null;
        mockLayoutMode = VideoLayoutMode.Grid;
      } else {
        mockSpotlightTileId = id;
        mockLayoutMode = VideoLayoutMode.Spotlight;
      }
      break;
    }
    default:
      return; // other action types are no-ops in this mock — nothing else under test dispatches them
  }
  mockCommitLayoutSnapshot();
}

vi.mock('../../contexts/VoiceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/VoiceContext')>();
  return {
    ...actual,
    useVoice: vi.fn(() => {
      const layout = useSyncExternalStore(mockSubscribeLayoutState, mockGetLayoutSnapshot);
      return {
        isDeafened: false,
        watchingCameras: mockWatchingCameras,
        watchingScreenShares: mockWatchingScreenShares,
        hiddenLocalTiles: new Set<string>(),
        layoutMode: layout.layoutMode,
        pinnedTileId: layout.pinnedTileId,
        spotlightTileId: layout.spotlightTileId,
      };
    }),
    useVoiceDispatch: vi.fn(() => ({
      dispatch: vi.fn(mockDispatchLayoutAction),
      stateRef: { current: {} },
    })),
  };
});

vi.mock('../../hooks/useTrackSubscription', () => ({
  useTrackSubscriptionActions: vi.fn(() => ({
    watchCamera: vi.fn(),
    stopWatchingCamera: vi.fn(),
    watchScreenShare: vi.fn(),
    stopWatchingScreenShare: vi.fn(),
  })),
}));

vi.mock('../../hooks/useRoom', () => ({
  useRoom: vi.fn(() => ({ room: { on: vi.fn(), off: vi.fn() } })),
}));

vi.mock('../../components/Common/UserAvatar', () => ({
  default: ({ userId }: { userId?: string }) => (
    <div data-testid="user-avatar" data-user-id={userId} />
  ),
}));

// jsdom doesn't implement HTMLMediaElement.play() — stub it to return a resolved promise
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// --- Event emitter helpers ---
type Handler = (...args: unknown[]) => void;
let roomEventHandlers: Map<string, Set<Handler>>;
let localEventHandlers: Map<string, Set<Handler>>;

function emitRoomEvent(event: string, ...args: unknown[]) {
  roomEventHandlers.get(event)?.forEach((h) => h(...args));
}

// --- Mock track / participant factories ---
function createMockTrackPublication(source: string, muted = false) {
  return {
    source,
    isMuted: muted,
    track: { attach: vi.fn(), detach: vi.fn() },
  };
}

function createMockParticipant(
  identity: string,
  videoTracks: ReturnType<typeof createMockTrackPublication>[] = [],
  audioTracks: ReturnType<typeof createMockTrackPublication>[] = [],
) {
  const videoMap = new Map<string, ReturnType<typeof createMockTrackPublication>>();
  videoTracks.forEach((t, i) => videoMap.set(`video-${i}`, t));
  const audioMap = new Map<string, ReturnType<typeof createMockTrackPublication>>();
  audioTracks.forEach((t, i) => audioMap.set(`audio-${i}`, t));

  return {
    identity,
    name: identity,
    videoTrackPublications: videoMap,
    audioTrackPublications: audioMap,
  };
}

// --- Mock room ---
let mockLocalParticipant: ReturnType<typeof createMockParticipant> & {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
};
let remoteParticipants: Map<string, ReturnType<typeof createMockParticipant>>;
let mockRoom: {
  localParticipant: typeof mockLocalParticipant;
  remoteParticipants: typeof remoteParticipants;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
};

function buildMockRoom() {
  roomEventHandlers = new Map();
  localEventHandlers = new Map();

  mockLocalParticipant = {
    ...createMockParticipant('local-user'),
    on: vi.fn((event: string, handler: Handler) => {
      if (!localEventHandlers.has(event)) localEventHandlers.set(event, new Set());
      localEventHandlers.get(event)!.add(handler);
      return mockLocalParticipant;
    }),
    off: vi.fn((event: string, handler: Handler) => {
      localEventHandlers.get(event)?.delete(handler);
      return mockLocalParticipant;
    }),
  };

  remoteParticipants = new Map();

  mockRoom = {
    localParticipant: mockLocalParticipant,
    remoteParticipants,
    on: vi.fn((event: string, handler: Handler) => {
      if (!roomEventHandlers.has(event)) roomEventHandlers.set(event, new Set());
      roomEventHandlers.get(event)!.add(handler);
      return mockRoom;
    }),
    off: vi.fn((event: string, handler: Handler) => {
      roomEventHandlers.get(event)?.delete(handler);
      return mockRoom;
    }),
  };

  return mockRoom;
}

// --- Mock livekit-client ---
vi.mock('livekit-client', () => ({
  RoomEvent: {
    TrackPublished: 'trackPublished',
    TrackUnpublished: 'trackUnpublished',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    TrackMuted: 'trackMuted',
    TrackUnmuted: 'trackUnmuted',
    ParticipantDisconnected: 'participantDisconnected',
    ParticipantConnected: 'participantConnected',
  },
  Track: {
    Source: {
      Camera: 'camera',
      Microphone: 'microphone',
      ScreenShare: 'screen_share',
      ScreenShareAudio: 'screen_share_audio',
    },
  },
}));

// --- Mock hooks ---
const mockActions = {
  toggleMute: vi.fn(),
  toggleDeafen: vi.fn(),
  toggleVideo: vi.fn(),
  toggleScreenShare: vi.fn(),
  setShowVideoTiles: vi.fn(),
  leaveVoiceChannel: vi.fn(),
  switchAudioInputDevice: vi.fn(),
  switchVideoInputDevice: vi.fn(),
  joinVoiceChannel: vi.fn(),
  joinDmVoice: vi.fn(),
  toggleAudio: vi.fn(),
  switchAudioOutputDevice: vi.fn(),
};

const defaultVoiceState = {
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
  showVideoTiles: true,
  screenShareAudioFailed: false,
  selectedAudioInputId: null,
  selectedAudioOutputId: null,
  selectedVideoInputId: null,
  room: null as typeof mockRoom | null,
};

let voiceState = { ...defaultVoiceState };

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: vi.fn(() => ({
    state: voiceState,
    actions: mockActions,
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
    isPortrait: false,
    deviceType: 'desktop',
  })),
}));

vi.mock('../../contexts/ReplayBufferContext', () => ({
  useReplayBufferState: vi.fn(() => ({
    isReplayBufferActive: false,
  })),
}));

// Import mocked hooks for overriding in tests
const { useVoiceConnection } = await import('../../hooks/useVoiceConnection');
const { useLocalMediaState } = await import('../../hooks/useLocalMediaState');

describe('VideoTiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildMockRoom();
    mockWatchingCameras = new Set<string>();
    mockWatchingScreenShares = new Set<string>();
    mockResetLayoutState();
    voiceState = { ...defaultVoiceState, room: mockRoom };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);
    vi.mocked(useLocalMediaState).mockReturnValue({
      isCameraEnabled: false,
      isMicrophoneEnabled: true,
      isScreenShareEnabled: false,
      audioTrack: undefined,
      videoTrack: undefined,
    });
  });

  it('returns null when not connected', () => {
    voiceState = { ...defaultVoiceState, isConnected: false, room: null };
    vi.mocked(useVoiceConnection).mockReturnValue({
      state: voiceState,
      actions: mockActions,
    } as never);

    const { container } = renderWithProviders(<VideoTiles />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the local participant as an avatar tile when connected but no video tracks', () => {
    renderWithProviders(<VideoTiles />);
    expect(screen.getByText(/local-user/)).toBeInTheDocument();
    expect(screen.queryByText(/enable your camera or screen share/i)).not.toBeInTheDocument();
  });

  it('renders tiles for remote participant with camera', () => {
    const remoteCam = createMockTrackPublication('camera');
    const remoteAudio = createMockTrackPublication('microphone');
    remoteParticipants.set(
      'remote-1',
      createMockParticipant('RemoteUser', [remoteCam], [remoteAudio]),
    );

    renderWithProviders(<VideoTiles />);
    expect(screen.getByText('RemoteUser')).toBeInTheDocument();
  });

  it('renders tiles for remote participant with screen share', () => {
    const remoteScreen = createMockTrackPublication('screen_share');
    remoteParticipants.set(
      'remote-1',
      createMockParticipant('ScreenSharer', [remoteScreen]),
    );

    renderWithProviders(<VideoTiles />);
    expect(screen.getByText(/ScreenSharer/)).toBeInTheDocument();
  });

  describe('stale memoization fix (#72, #85)', () => {
    it('updates tiles when remote participant publishes a track', () => {
      renderWithProviders(<VideoTiles />);

      // Initially only the local participant's avatar tile
      expect(screen.getByText(/local-user/)).toBeInTheDocument();
      expect(screen.queryByText('NewUser')).not.toBeInTheDocument();

      // Simulate remote participant publishing a camera track
      const remoteCam = createMockTrackPublication('camera');
      remoteParticipants.set(
        'remote-1',
        createMockParticipant('NewUser', [remoteCam]),
      );

      act(() => {
        // Both handlers listen on trackPublished — pass a publication so auto-show handler doesn't crash
        emitRoomEvent('trackPublished', { source: 'camera' });
      });

      // Tile should now appear
      expect(screen.getByText('NewUser')).toBeInTheDocument();
    });

    it('converts to an avatar tile when remote participant unpublishes a track', () => {
      const remoteCam = createMockTrackPublication('camera');
      const participant = createMockParticipant('LeavingUser', [remoteCam]);
      remoteParticipants.set('remote-1', participant);

      renderWithProviders(<VideoTiles />);
      expect(screen.getByText('LeavingUser')).toBeInTheDocument();
      // Camera is unwatched, so this starts as a placeholder tile.
      expect(screen.getByText(/click to watch/i)).toBeInTheDocument();

      // Remove the track
      participant.videoTrackPublications.clear();

      act(() => {
        emitRoomEvent('trackUnpublished', { source: 'camera' });
      });

      // The participant is still connected, so they now render as an avatar
      // tile instead of disappearing — the placeholder affordance is gone.
      expect(screen.getByText('LeavingUser')).toBeInTheDocument();
      expect(screen.queryByText(/click to watch/i)).not.toBeInTheDocument();
    });

    it('removes tiles when remote participant disconnects', () => {
      const remoteCam = createMockTrackPublication('camera');
      remoteParticipants.set(
        'remote-1',
        createMockParticipant('DisconnectedUser', [remoteCam]),
      );

      renderWithProviders(<VideoTiles />);
      expect(screen.getByText('DisconnectedUser')).toBeInTheDocument();

      // Participant disconnects
      remoteParticipants.delete('remote-1');

      act(() => {
        emitRoomEvent('participantDisconnected');
      });

      expect(screen.queryByText('DisconnectedUser')).not.toBeInTheDocument();
    });

    it('updates tiles when remote track is subscribed', () => {
      renderWithProviders(<VideoTiles />);

      const remoteCam = createMockTrackPublication('camera');
      remoteParticipants.set(
        'remote-1',
        createMockParticipant('SubscribedUser', [remoteCam]),
      );

      act(() => {
        emitRoomEvent('trackSubscribed');
      });

      expect(screen.getByText('SubscribedUser')).toBeInTheDocument();
    });

    it('converts to an avatar tile when remote track mute state changes', () => {
      const remoteCam = createMockTrackPublication('camera', false);
      const participant = createMockParticipant('MutingUser', [remoteCam]);
      remoteParticipants.set('remote-1', participant);

      renderWithProviders(<VideoTiles />);
      expect(screen.getByText('MutingUser')).toBeInTheDocument();
      // Camera is unwatched, so this starts as a placeholder tile.
      expect(screen.getByText(/click to watch/i)).toBeInTheDocument();

      // Mute the camera track — the isMuted check filters it out of tile-building,
      // so the participant falls back to an avatar tile instead of disappearing.
      remoteCam.isMuted = true;

      act(() => {
        emitRoomEvent('trackMuted');
      });

      expect(screen.getByText('MutingUser')).toBeInTheDocument();
      expect(screen.queryByText(/click to watch/i)).not.toBeInTheDocument();
    });
  });

  it('renders one tile per remote participant with video', () => {
    mockWatchingCameras = new Set(['UserA', 'UserB']);
    remoteParticipants.set(
      'remote-1',
      createMockParticipant('UserA', [createMockTrackPublication('camera')]),
    );
    remoteParticipants.set(
      'remote-2',
      createMockParticipant('UserB', [createMockTrackPublication('camera')]),
    );

    renderWithProviders(<VideoTiles />);

    expect(screen.getByText('UserA')).toBeInTheDocument();
    expect(screen.getByText('UserB')).toBeInTheDocument();
  });

  describe('avatar tiles', () => {
    it('renders the local participant as an avatar tile with their name when all tracks are off', () => {
      renderWithProviders(<VideoTiles />);

      expect(screen.getByText(/local-user/)).toBeInTheDocument();
      const avatar = screen.getByTestId('user-avatar');
      expect(avatar).toHaveAttribute('data-user-id', 'local-user');
      // Not the placeholder branch — placeholder tiles carry a "Click to show" hint.
      expect(screen.queryByText(/click to show/i)).not.toBeInTheDocument();
    });

    it('renders a remote participant with no tracks as an avatar tile', () => {
      remoteParticipants.set('remote-1', createMockParticipant('NoTracksUser'));

      renderWithProviders(<VideoTiles />);

      expect(screen.getByText('NoTracksUser')).toBeInTheDocument();
      // Not the placeholder branch — placeholder tiles carry a "Click to watch" hint.
      expect(screen.queryByText(/click to watch/i)).not.toBeInTheDocument();
    });

    it('renders a placeholder (not an avatar tile) for a remote participant with an unwatched camera', () => {
      // mockWatchingCameras left empty — the camera track is published but unwatched.
      remoteParticipants.set(
        'remote-1',
        createMockParticipant('UnwatchedUser', [createMockTrackPublication('camera')]),
      );

      renderWithProviders(<VideoTiles />);

      expect(screen.getByText('UnwatchedUser')).toBeInTheDocument();
      expect(screen.getByText(/click to watch/i)).toBeInTheDocument();
    });

    it('has no stop-watching affordance on an avatar tile', () => {
      remoteParticipants.set('remote-1', createMockParticipant('NoTracksUser'));

      renderWithProviders(<VideoTiles />);

      expect(screen.queryByTestId('VisibilityOffIcon')).not.toBeInTheDocument();
    });

    it('spotlights an avatar tile on click and re-pins it from the sidebar', async () => {
      remoteParticipants.set('remote-1', createMockParticipant('AvatarUser'));

      const { user } = renderWithProviders(<VideoTiles />);

      // Grid: clicking the avatar tile spotlights it
      const gridCard = screen.getByText('AvatarUser').closest('[class*="MuiCard"]')!;
      await user.click(gridCard);
      expect(screen.getByText('AvatarUser')).toBeInTheDocument();
      expect(screen.queryByText(/local-user/)).not.toBeInTheDocument();

      // Back to grid, then sidebar — default pin is the first watched tile (local-user)
      await user.click(screen.getByRole('button', { name: 'Grid Layout' }));
      await user.click(screen.getByRole('button', { name: 'Sidebar Layout' }));
      expect(
        screen.getByText(/local-user/).compareDocumentPosition(screen.getByText('AvatarUser')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // Clicking AvatarUser's sidebar tile re-pins it as the main view
      const sidebarCard = screen.getByText('AvatarUser').closest('[class*="MuiCard"]')!;
      await user.click(sidebarCard);
      expect(
        screen.getByText('AvatarUser').compareDocumentPosition(screen.getByText(/local-user/)) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('shows a newly-joined participant with no tracks as an avatar tile after ParticipantConnected fires', () => {
      renderWithProviders(<VideoTiles />);

      expect(screen.queryByText('JoiningUser')).not.toBeInTheDocument();

      remoteParticipants.set('remote-1', createMockParticipant('JoiningUser'));

      act(() => {
        emitRoomEvent('participantConnected');
      });

      expect(screen.getByText('JoiningUser')).toBeInTheDocument();
    });
  });

  describe('tile audio indicator picks the microphone publication', () => {
    it('uses the mic track even when a screen-share-audio publication comes first', () => {
      mockWatchingCameras = new Set(['SharerWithAudio']);
      // Screen-share audio publication listed BEFORE the mic: the old
      // `audioTrackPublications[0]` selection would pick it and show a live
      // mic indicator, even though the actual microphone is muted.
      const screenAudio = createMockTrackPublication('screen_share_audio', false);
      const mutedMic = createMockTrackPublication('microphone', true);
      remoteParticipants.set(
        'remote-1',
        createMockParticipant(
          'SharerWithAudio',
          [createMockTrackPublication('camera')],
          [screenAudio, mutedMic],
        ),
      );

      renderWithProviders(<VideoTiles />);

      // The muted mic must drive the indicator — not the unmuted share audio.
      // Scoped to this participant's tile: the local participant's own avatar
      // tile also shows a MicOffIcon since it has no microphone track.
      const card = screen.getByText('SharerWithAudio').closest('[class*="MuiCard"]') as HTMLElement;
      expect(within(card).getByTestId('MicOffIcon')).toBeInTheDocument();
      expect(within(card).queryByTestId('MicIcon')).not.toBeInTheDocument();
    });

    it('shows mic-off for a participant publishing only screen-share audio (no mic)', () => {
      mockWatchingCameras = new Set(['MiclessSharer']);
      remoteParticipants.set(
        'remote-1',
        createMockParticipant(
          'MiclessSharer',
          [createMockTrackPublication('camera')],
          [createMockTrackPublication('screen_share_audio', false)],
        ),
      );

      renderWithProviders(<VideoTiles />);

      // Scoped to this participant's tile — the local avatar tile also shows MicOffIcon.
      const card = screen.getByText('MiclessSharer').closest('[class*="MuiCard"]') as HTMLElement;
      expect(within(card).getByTestId('MicOffIcon')).toBeInTheDocument();
      expect(within(card).queryByTestId('MicIcon')).not.toBeInTheDocument();
    });

    it('shows a live mic indicator when the mic publication is unmuted', () => {
      mockWatchingCameras = new Set(['TalkingSharer']);
      remoteParticipants.set(
        'remote-1',
        createMockParticipant(
          'TalkingSharer',
          [createMockTrackPublication('camera')],
          [createMockTrackPublication('screen_share_audio', true), createMockTrackPublication('microphone', false)],
        ),
      );

      renderWithProviders(<VideoTiles />);

      // Scoped to this participant's tile — the local avatar tile shows MicOffIcon.
      const card = screen.getByText('TalkingSharer').closest('[class*="MuiCard"]') as HTMLElement;
      expect(within(card).getByTestId('MicIcon')).toBeInTheDocument();
      expect(within(card).queryByTestId('MicOffIcon')).not.toBeInTheDocument();
    });
  });

  describe('layout modes and pinning', () => {
    beforeEach(() => {
      mockWatchingCameras = new Set(['UserA', 'UserB']);
      remoteParticipants.set(
        'remote-1',
        createMockParticipant('UserA', [createMockTrackPublication('camera')], [createMockTrackPublication('microphone')]),
      );
      remoteParticipants.set(
        'remote-2',
        createMockParticipant('UserB', [createMockTrackPublication('camera')], [createMockTrackPublication('microphone')]),
      );
    });

    it('renders grid/sidebar/spotlight layout buttons on desktop', () => {
      renderWithProviders(<VideoTiles />);

      expect(screen.getByRole('button', { name: 'Grid Layout' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sidebar Layout' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Spotlight Layout' })).toBeInTheDocument();
    });

    it('clicking a tile in grid mode spotlights it — only the spotlit participant renders large', async () => {
      const { user } = renderWithProviders(<VideoTiles />);

      // Both tiles visible in grid mode
      expect(screen.getByText('UserA')).toBeInTheDocument();
      expect(screen.getByText('UserB')).toBeInTheDocument();

      // Click UserA's tile to enter spotlight mode
      const cardA = screen.getByText('UserA').closest('[class*="MuiCard"]')!;
      await user.click(cardA);

      // Spotlight layout renders only the spotlit tile
      expect(screen.getByText('UserA')).toBeInTheDocument();
      expect(screen.queryByText('UserB')).not.toBeInTheDocument();
    });

    it('spotlight layout button spotlights the first watched tile', async () => {
      const { user } = renderWithProviders(<VideoTiles />);

      const spotlightButton = screen.getByRole('button', { name: 'Spotlight Layout' });
      await user.click(spotlightButton);

      // No spotlightTileId selected — falls back to first watched tile, which
      // is now the local participant's avatar tile (local tiles are pushed
      // before remote tiles in the tile-building memo).
      expect(screen.getByText(/local-user/)).toBeInTheDocument();
      expect(screen.queryByText('UserA')).not.toBeInTheDocument();
      expect(screen.queryByText('UserB')).not.toBeInTheDocument();
    });

    it('tiles render no pin or fullscreen buttons (#320 — tile click handles both)', async () => {
      const { user } = renderWithProviders(<VideoTiles />);

      // CropFree only appears as the Spotlight Layout header button, never inside tiles
      const assertNoTileButtons = () => {
        expect(screen.queryByTestId('PushPinOutlinedIcon')).not.toBeInTheDocument();
        expect(screen.queryByTestId('PushPinIcon')).not.toBeInTheDocument();
        for (const icon of screen.queryAllByTestId('CropFreeIcon')) {
          expect(icon.closest('button')).toHaveAccessibleName('Spotlight Layout');
        }
      };

      // Grid layout
      assertNoTileButtons();

      // Spotlight a tile — still no per-tile pin/fullscreen buttons
      const cardB = screen.getByText('UserB').closest('[class*="MuiCard"]')!;
      await user.click(cardB);
      assertNoTileButtons();
    });

    it('sidebar layout pins the first watched tile by default and clicking a sidebar tile re-pins it', async () => {
      const { user } = renderWithProviders(<VideoTiles />);

      const sidebarButton = screen.getByRole('button', { name: 'Sidebar Layout' });
      await user.click(sidebarButton);

      // Default main tile is the first watched tile (UserA before UserB in DOM)
      expect(
        screen.getByText('UserA').compareDocumentPosition(screen.getByText('UserB')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // Clicking UserB's sidebar tile pins it as the main view
      const cardB = screen.getByText('UserB').closest('[class*="MuiCard"]')!;
      await user.click(cardB);

      expect(
        screen.getByText('UserB').compareDocumentPosition(screen.getByText('UserA')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('grid layout button returns from spotlight to grid', async () => {
      const { user } = renderWithProviders(<VideoTiles />);

      // Enter spotlight
      await user.click(screen.getByRole('button', { name: 'Spotlight Layout' }));
      expect(screen.queryByText('UserB')).not.toBeInTheDocument();

      // Back to grid
      await user.click(screen.getByRole('button', { name: 'Grid Layout' }));
      expect(screen.getByText('UserA')).toBeInTheDocument();
      expect(screen.getByText('UserB')).toBeInTheDocument();
    });
  });

  // Auto-show behavior was removed in #336 — screen share opt-in is now per-participant

  describe('spotlight objectFit (#106)', () => {
    it('uses contain objectFit for camera video when spotlighted', async () => {
      mockWatchingCameras = new Set(['SpotlightUser']);
      const remoteCam = createMockTrackPublication('camera');
      const remoteAudio = createMockTrackPublication('microphone');
      remoteParticipants.set(
        'remote-1',
        createMockParticipant('SpotlightUser', [remoteCam], [remoteAudio]),
      );

      const { user } = renderWithProviders(<VideoTiles />);

      // Click the tile to enter spotlight mode
      const tileText = screen.getByText('SpotlightUser');
      const card = tileText.closest('[class*="MuiCard"]')!;
      await user.click(card);

      // After spotlight, re-render should show the video with contain
      const videos = document.querySelectorAll('video');
      const cameraVideo = Array.from(videos).find(v => v.style.objectFit === 'contain');
      expect(cameraVideo).toBeTruthy();
    });
  });

  describe('grid layout (#83)', () => {
    it('does not set minHeight on video tiles', () => {
      mockWatchingCameras = new Set(['GridUser']);
      const remoteCam = createMockTrackPublication('camera');
      remoteParticipants.set(
        'remote-1',
        createMockParticipant('GridUser', [remoteCam]),
      );

      renderWithProviders(<VideoTiles />);

      const cards = document.querySelectorAll('[class*="MuiCard"]');
      cards.forEach(card => {
        const style = (card as HTMLElement).style;
        expect(style.minHeight).not.toBe('200px');
      });
    });

    it('uses flexbox layout instead of MUI Grid', () => {
      mockWatchingCameras = new Set(['User1', 'User2']);
      const remoteCam1 = createMockTrackPublication('camera');
      const remoteCam2 = createMockTrackPublication('camera');
      remoteParticipants.set(
        'remote-1',
        createMockParticipant('User1', [remoteCam1]),
      );
      remoteParticipants.set(
        'remote-2',
        createMockParticipant('User2', [remoteCam2]),
      );

      renderWithProviders(<VideoTiles />);

      // Should not have any MUI Grid elements
      const grids = document.querySelectorAll('[class*="MuiGrid"]');
      expect(grids.length).toBe(0);
    });
  });

  describe('event listener cleanup', () => {
    it('removes all room event listeners on unmount', () => {
      const { unmount } = renderWithProviders(<VideoTiles />);

      unmount();

      expect(mockRoom.off).toHaveBeenCalledWith('trackPublished', expect.any(Function));
      expect(mockRoom.off).toHaveBeenCalledWith('trackUnpublished', expect.any(Function));
      expect(mockRoom.off).toHaveBeenCalledWith('trackSubscribed', expect.any(Function));
      expect(mockRoom.off).toHaveBeenCalledWith('trackUnsubscribed', expect.any(Function));
      expect(mockRoom.off).toHaveBeenCalledWith('trackMuted', expect.any(Function));
      expect(mockRoom.off).toHaveBeenCalledWith('trackUnmuted', expect.any(Function));
      expect(mockRoom.off).toHaveBeenCalledWith('participantDisconnected', expect.any(Function));
      expect(mockRoom.off).toHaveBeenCalledWith('participantConnected', expect.any(Function));
    });

    it('removes local participant event listeners on unmount', () => {
      const { unmount } = renderWithProviders(<VideoTiles />);

      unmount();

      expect(mockLocalParticipant.off).toHaveBeenCalledWith('trackPublished', expect.any(Function));
      expect(mockLocalParticipant.off).toHaveBeenCalledWith('trackUnpublished', expect.any(Function));
    });
  });
});
