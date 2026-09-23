import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DisconnectReason, type Room } from 'livekit-client';
import { useVoiceForegroundResync } from '../../hooks/useVoiceForegroundResync';
import { VoiceActionType, VoiceSessionType, type VoiceState } from '../../contexts/VoiceContext';
import { VideoLayoutMode } from '../../types/videoLayout';

const mockDispatch = vi.fn();

vi.mock('../../contexts/VoiceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/VoiceContext')>();
  return {
    ...actual,
    useVoiceDispatch: () => ({ dispatch: mockDispatch, stateRef: { current: null } }),
  };
});

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

interface MockRoom {
  state: string;
  canPlaybackAudio: boolean;
  startAudio: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}

function createMockRoom(overrides: Partial<MockRoom> = {}): MockRoom {
  return {
    state: 'connected',
    canPlaybackAudio: true,
    startAudio: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  };
}

function createVoiceState(overrides: Partial<VoiceState> = {}): VoiceState {
  return {
    isConnected: true,
    isConnecting: false,
    connectionError: null,
    contextType: VoiceSessionType.Channel,
    currentChannelId: 'chan-1',
    channelName: 'General Voice',
    communityId: 'comm-1',
    isPrivate: false,
    createdAt: '2026-01-01T00:00:00.000Z',
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
    ...overrides,
  };
}

const createActions = () => ({
  joinVoiceChannel: vi.fn().mockResolvedValue(undefined),
  joinDmVoice: vi.fn().mockResolvedValue(undefined),
});

async function fireVisibilityChange() {
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    // flush the async resync
    await Promise.resolve();
  });
}

describe('useVoiceForegroundResync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
  });

  it('rejoins the channel when the room is dead but context says connected', async () => {
    const room = createMockRoom({ state: 'disconnected' });
    const actions = createActions();
    renderHook(() =>
      useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions })
    );

    await fireVisibilityChange();

    expect(actions.joinVoiceChannel).toHaveBeenCalledWith(
      'chan-1',
      'General Voice',
      'comm-1',
      false,
      '2026-01-01T00:00:00.000Z'
    );
  });

  it('rejoins via joinDmVoice for DM contexts', async () => {
    const actions = createActions();
    renderHook(() =>
      useVoiceForegroundResync({
        room: null,
        state: createVoiceState({
          contextType: VoiceSessionType.Dm,
          currentChannelId: null,
          channelName: null,
          communityId: null,
          currentDmGroupId: 'dm-1',
          dmGroupName: 'Alice & Bob',
        }),
        actions,
      })
    );

    await fireVisibilityChange();

    expect(actions.joinDmVoice).toHaveBeenCalledWith('dm-1', 'Alice & Bob');
    expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it('dispatches SetDisconnected when the rejoin fails', async () => {
    const actions = createActions();
    actions.joinVoiceChannel.mockRejectedValue(new Error('token expired'));
    renderHook(() =>
      useVoiceForegroundResync({
        room: createMockRoom({ state: 'disconnected' }) as unknown as Room,
        state: createVoiceState(),
        actions,
      })
    );

    await fireVisibilityChange();

    expect(mockDispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetDisconnected });
  });

  it('dispatches SetDisconnected when context state is too incomplete to rejoin', async () => {
    const actions = createActions();
    renderHook(() =>
      useVoiceForegroundResync({
        room: null,
        state: createVoiceState({ channelName: null }),
        actions,
      })
    );

    await fireVisibilityChange();

    expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetDisconnected });
  });

  it('calls startAudio when connected but audio playback is blocked', async () => {
    const room = createMockRoom({ canPlaybackAudio: false });
    renderHook(() =>
      useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions: createActions() })
    );

    await fireVisibilityChange();

    expect(room.startAudio).toHaveBeenCalled();
  });

  it('does nothing when the room is healthy and audio is playable', async () => {
    const room = createMockRoom();
    const actions = createActions();
    renderHook(() =>
      useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions })
    );

    await fireVisibilityChange();

    expect(room.startAudio).not.toHaveBeenCalled();
    expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('does nothing when voice context is not connected', async () => {
    const actions = createActions();
    renderHook(() =>
      useVoiceForegroundResync({ room: null, state: createVoiceState({ isConnected: false }), actions })
    );

    await fireVisibilityChange();

    expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it('does nothing while hidden', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const actions = createActions();
    renderHook(() =>
      useVoiceForegroundResync({
        room: createMockRoom({ state: 'disconnected' }) as unknown as Room,
        state: createVoiceState(),
        actions,
      })
    );

    await fireVisibilityChange();

    expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it('rejoins on unexpected room disconnect while visible', async () => {
    const room = createMockRoom();
    const actions = createActions();
    renderHook(() =>
      useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions })
    );

    const disconnectedHandler = room.on.mock.calls.find(([event]) => event === 'disconnected')?.[1];
    expect(disconnectedHandler).toBeDefined();

    // Simulate the room dying with a server-side reason
    room.state = 'disconnected';
    await act(async () => {
      disconnectedHandler!(DisconnectReason.SERVER_SHUTDOWN);
      await Promise.resolve();
    });

    expect(actions.joinVoiceChannel).toHaveBeenCalled();
  });

  it('ignores CLIENT_INITIATED disconnects (user hangup)', async () => {
    const room = createMockRoom();
    const actions = createActions();
    renderHook(() =>
      useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions })
    );

    const disconnectedHandler = room.on.mock.calls.find(([event]) => event === 'disconnected')?.[1];
    room.state = 'disconnected';
    await act(async () => {
      disconnectedHandler!(DisconnectReason.CLIENT_INITIATED);
      await Promise.resolve();
    });

    expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it('does not start a second rejoin while one is in flight', async () => {
    const actions = createActions();
    let resolveJoin: () => void;
    actions.joinVoiceChannel.mockImplementation(
      () => new Promise<void>((resolve) => { resolveJoin = resolve; })
    );
    renderHook(() =>
      useVoiceForegroundResync({
        room: createMockRoom({ state: 'disconnected' }) as unknown as Room,
        state: createVoiceState(),
        actions,
      })
    );

    await fireVisibilityChange();
    await fireVisibilityChange();

    expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveJoin!();
      await Promise.resolve();
    });
  });
});
