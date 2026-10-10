import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DisconnectReason, type Room } from 'livekit-client';
import { useVoiceForegroundResync, REJOIN_BACKOFF_MS } from '../../hooks/useVoiceForegroundResync';
import { VoiceActionType, VoiceEndReason, VoiceSessionType, type VoiceState } from '../../contexts/VoiceContext';
import { VideoLayoutMode } from '../../types/videoLayout';
import { ROOM_EVENT, CONNECTION_STATE } from '../../features/voice/livekitEvents';
import { cancelVoiceReconnect } from '../../features/voice/reconnectControl';
import { createElectronWrapper } from '../test-utils/wrappers';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';

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
  localParticipant?: { isMicrophoneEnabled: boolean };
}

function createMockRoom(overrides: Partial<MockRoom> = {}): MockRoom {
  return {
    state: CONNECTION_STATE.Connected,
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
    reconnect: null,
    lastEnded: null,
    ...overrides,
  };
}

const createActions = () => ({
  joinVoiceChannel: vi.fn().mockResolvedValue(undefined),
  joinDmVoice: vi.fn().mockResolvedValue(undefined),
  endVoiceSession: vi.fn().mockResolvedValue(undefined),
});

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

async function fireVisibilityChange() {
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });
}

/** Advance fake time, flushing the promises the loop awaits. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function disconnectHandlerOf(room: MockRoom) {
  const handler = room.on.mock.calls.find(([event]) => event === ROOM_EVENT.Disconnected)?.[1];
  expect(handler).toBeDefined();
  return handler as (reason?: DisconnectReason) => void;
}

async function fireDisconnect(room: MockRoom, reason?: DisconnectReason) {
  room.state = CONNECTION_STATE.Disconnected;
  await act(async () => {
    disconnectHandlerOf(room)(reason);
    await Promise.resolve();
  });
}

function reconnectDispatches() {
  return mockDispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action.type === VoiceActionType.SetReconnect);
}

const deadRoom = () => createMockRoom({ state: CONNECTION_STATE.Disconnected });

describe('useVoiceForegroundResync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setVisibility('visible');
    setOnline(true);
  });

  afterEach(() => {
    // Stop any loop a test left running
    cancelVoiceReconnect();
    vi.useRealTimers();
  });

  describe('rejoin from live context', () => {
    it('quietly rejoins the channel after the first backoff delay', async () => {
      const actions = createActions();
      renderHook(() =>
        useVoiceForegroundResync({ room: deadRoom() as unknown as Room, state: createVoiceState(), actions })
      );

      await fireVisibilityChange();
      expect(actions.joinVoiceChannel).not.toHaveBeenCalled();

      await advance(REJOIN_BACKOFF_MS[0]);
      expect(actions.joinVoiceChannel).toHaveBeenCalledWith(
        'chan-1',
        'General Voice',
        'comm-1',
        false,
        '2026-01-01T00:00:00.000Z',
        { startMuted: false, quiet: true },
      );
      // Success clears the reconnect state
      expect(mockDispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetReconnect, payload: null });
      expect(actions.endVoiceSession).not.toHaveBeenCalled();
    });

    it('rejoins muted when the dead room had the mic off ("Join muted" survives a resync)', async () => {
      const room = { ...deadRoom(), localParticipant: { isMicrophoneEnabled: false } };
      const actions = createActions();
      renderHook(() =>
        useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions })
      );

      await fireVisibilityChange();
      await advance(REJOIN_BACKOFF_MS[0]);

      expect(actions.joinVoiceChannel.mock.calls[0][5]).toEqual({ startMuted: true, quiet: true });
    });

    it('keeps the mic muted across every retry', async () => {
      const room = { ...deadRoom(), localParticipant: { isMicrophoneEnabled: false } };
      const actions = createActions();
      actions.joinVoiceChannel.mockRejectedValueOnce(new Error('offline'));
      renderHook(() =>
        useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions })
      );

      await fireVisibilityChange();
      await advance(REJOIN_BACKOFF_MS[0] + REJOIN_BACKOFF_MS[1]);

      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(2);
      expect(actions.joinVoiceChannel.mock.calls[1][5]).toEqual({ startMuted: true, quiet: true });
    });

    it('rejoins with the mic on when the dead room had it on', async () => {
      const room = { ...deadRoom(), localParticipant: { isMicrophoneEnabled: true } };
      const actions = createActions();
      renderHook(() =>
        useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions })
      );

      await fireVisibilityChange();
      await advance(REJOIN_BACKOFF_MS[0]);

      expect(actions.joinVoiceChannel.mock.calls[0][5]).toEqual({ startMuted: false, quiet: true });
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
      await advance(REJOIN_BACKOFF_MS[0]);

      expect(actions.joinDmVoice).toHaveBeenCalledWith('dm-1', 'Alice & Bob', { startMuted: false, quiet: true });
      expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
    });

    it('dispatches SetDisconnected when context state is too incomplete to rejoin', async () => {
      const actions = createActions();
      renderHook(() =>
        useVoiceForegroundResync({ room: null, state: createVoiceState({ channelName: null }), actions })
      );

      await fireVisibilityChange();
      await advance(60_000);

      expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
      expect(mockDispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetDisconnected });
    });

    it('does not start a second loop while one is running', async () => {
      const actions = createActions();
      let resolveJoin: () => void;
      actions.joinVoiceChannel.mockImplementation(
        () => new Promise<void>((resolve) => { resolveJoin = resolve; })
      );
      renderHook(() =>
        useVoiceForegroundResync({ room: deadRoom() as unknown as Room, state: createVoiceState(), actions })
      );

      await fireVisibilityChange();
      await advance(REJOIN_BACKOFF_MS[0]);
      await fireVisibilityChange();
      await advance(REJOIN_BACKOFF_MS[1]);

      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(1);
      await act(async () => {
        resolveJoin!();
        await Promise.resolve();
      });
    });
  });

  describe('backoff', () => {
    it('retries on the 1, 2, 5, 10, 30… s schedule, then ends the call with ReconnectFailed', async () => {
      const actions = createActions();
      actions.joinVoiceChannel.mockRejectedValue(new Error('token expired'));
      renderHook(() =>
        useVoiceForegroundResync({ room: deadRoom() as unknown as Room, state: createVoiceState(), actions })
      );

      await fireVisibilityChange();

      let elapsed = 0;
      for (let i = 0; i < REJOIN_BACKOFF_MS.length; i++) {
        // Just before this attempt's delay runs out: no new attempt yet
        await advance(REJOIN_BACKOFF_MS[i] - 1);
        expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(i);
        await advance(1);
        expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(i + 1);
        elapsed += REJOIN_BACKOFF_MS[i];
      }

      expect(REJOIN_BACKOFF_MS.slice(0, 5)).toEqual([1000, 2000, 5000, 10000, 30000]);
      // About 3-5 minutes in all
      expect(elapsed).toBeGreaterThanOrEqual(3 * 60_000);
      expect(elapsed).toBeLessThanOrEqual(5 * 60_000);
      expect(actions.endVoiceSession).toHaveBeenCalledWith(VoiceEndReason.ReconnectFailed, 'token expired');

      // Attempt numbers are exposed for the bar
      const attempts = reconnectDispatches()
        .map((a) => a.payload?.attempt)
        .filter((n, i, all) => n !== undefined && all.indexOf(n) === i);
      expect(attempts).toEqual(REJOIN_BACKOFF_MS.map((_, i) => i + 1));
      const first = reconnectDispatches()[0].payload;
      expect(first.maxAttempts).toBe(REJOIN_BACKOFF_MS.length);
      expect(first.nextRetryAt).toBe(Date.now() - elapsed + REJOIN_BACKOFF_MS[0]);

      // Nothing more after giving up
      await advance(10 * 60_000);
      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(REJOIN_BACKOFF_MS.length);
    });

    it('waits for the browser to be online before an attempt', async () => {
      setOnline(false);
      const actions = createActions();
      renderHook(() =>
        useVoiceForegroundResync({ room: deadRoom() as unknown as Room, state: createVoiceState(), actions })
      );

      await fireVisibilityChange();
      await advance(60_000);
      expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
      // Waiting doesn't use up attempts, and shows no countdown
      expect(reconnectDispatches().slice(-1)[0]?.payload).toMatchObject({ attempt: 1, nextRetryAt: null });

      setOnline(true);
      await act(async () => {
        window.dispatchEvent(new Event('online'));
        await Promise.resolve();
      });
      await advance(0);
      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(1);
    });

    it('waits for the window to be visible before an attempt', async () => {
      const room = createMockRoom();
      const actions = createActions();
      renderHook(() =>
        useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions })
      );

      // Dropped while hidden (e.g. a minimized window)
      setVisibility('hidden');
      await fireDisconnect(room, DisconnectReason.SIGNAL_CLOSE);
      await advance(60_000);
      expect(actions.joinVoiceChannel).not.toHaveBeenCalled();

      setVisibility('visible');
      await fireVisibilityChange();
      await advance(0);
      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(1);
    });

    it('a foreground transition skips the current wait', async () => {
      const actions = createActions();
      actions.joinVoiceChannel.mockRejectedValue(new Error('offline'));
      renderHook(() =>
        useVoiceForegroundResync({ room: deadRoom() as unknown as Room, state: createVoiceState(), actions })
      );

      await fireVisibilityChange();
      // Attempts 1-4 fail; attempt 5 waits 30 s
      await advance(REJOIN_BACKOFF_MS.slice(0, 4).reduce((a, b) => a + b, 0));
      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(4);

      await act(async () => {
        window.dispatchEvent(new Event('pageshow'));
        await Promise.resolve();
      });
      await advance(0);
      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(5);
    });

    it('resets on success: the next drop starts again at attempt 1', async () => {
      const room = createMockRoom();
      const actions = createActions();
      actions.joinVoiceChannel.mockRejectedValueOnce(new Error('offline'));
      renderHook(() =>
        useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions })
      );

      await fireDisconnect(room, DisconnectReason.SIGNAL_CLOSE);
      await advance(REJOIN_BACKOFF_MS[0] + REJOIN_BACKOFF_MS[1]);
      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenCalledWith({ type: VoiceActionType.SetReconnect, payload: null });

      mockDispatch.mockClear();
      await fireDisconnect(room, DisconnectReason.SIGNAL_CLOSE);
      expect(reconnectDispatches()[0].payload).toMatchObject({ attempt: 1 });
      await advance(REJOIN_BACKOFF_MS[0]);
      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(3);
    });

    it('cancelling stops the loop (hang-up from the voice bar)', async () => {
      const actions = createActions();
      actions.joinVoiceChannel.mockRejectedValue(new Error('offline'));
      renderHook(() =>
        useVoiceForegroundResync({ room: deadRoom() as unknown as Room, state: createVoiceState(), actions })
      );

      await fireVisibilityChange();
      await advance(REJOIN_BACKOFF_MS[0]);
      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(1);

      expect(cancelVoiceReconnect()).toBe(true);
      await advance(10 * 60_000);

      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(1);
      expect(actions.endVoiceSession).not.toHaveBeenCalled();
    });

    it('stops when the call ends (isConnected goes false)', async () => {
      const actions = createActions();
      const { rerender } = renderHook(
        ({ state }) => useVoiceForegroundResync({ room: null, state, actions }),
        { initialProps: { state: createVoiceState() } },
      );

      await fireVisibilityChange();
      rerender({ state: createVoiceState({ isConnected: false }) });
      await advance(10 * 60_000);

      expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
    });
  });

  describe('disconnect reasons', () => {
    it.each([
      ['DUPLICATE_IDENTITY (same account on another device)', DisconnectReason.DUPLICATE_IDENTITY, VoiceEndReason.DuplicateIdentity],
      ['PARTICIPANT_REMOVED', DisconnectReason.PARTICIPANT_REMOVED, VoiceEndReason.ParticipantRemoved],
      ['ROOM_DELETED', DisconnectReason.ROOM_DELETED, VoiceEndReason.RoomDeleted],
    ])('does not rejoin after %s and records the reason', async (_label, reason, endReason) => {
      const room = createMockRoom();
      const actions = createActions();
      renderHook(() =>
        useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions })
      );

      await fireDisconnect(room, reason);
      await advance(10 * 60_000);

      expect(actions.endVoiceSession).toHaveBeenCalledWith(endReason);
      expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
      expect(reconnectDispatches()).toHaveLength(0);
    });

    it('ignores CLIENT_INITIATED disconnects (user hangup)', async () => {
      const room = createMockRoom();
      const actions = createActions();
      renderHook(() =>
        useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions })
      );

      await fireDisconnect(room, DisconnectReason.CLIENT_INITIATED);
      await advance(60_000);

      expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
      expect(actions.endVoiceSession).not.toHaveBeenCalled();
    });

    it.each([
      ['SERVER_SHUTDOWN', DisconnectReason.SERVER_SHUTDOWN],
      ['SIGNAL_CLOSE', DisconnectReason.SIGNAL_CLOSE],
      ['STATE_MISMATCH', DisconnectReason.STATE_MISMATCH],
      ['UNKNOWN_REASON', DisconnectReason.UNKNOWN_REASON],
      ['no reason', undefined],
    ])('rejoins after %s', async (_label, reason) => {
      const room = createMockRoom();
      const actions = createActions();
      renderHook(() =>
        useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions })
      );

      await fireDisconnect(room, reason);
      await advance(REJOIN_BACKOFF_MS[0]);

      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(1);
      expect(actions.endVoiceSession).not.toHaveBeenCalled();
    });
  });

  describe('foreground checks on a live room', () => {
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
      await advance(60_000);

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
      await advance(60_000);

      expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
    });

    it('does nothing on a visibilitychange to hidden', async () => {
      setVisibility('hidden');
      const actions = createActions();
      renderHook(() =>
        useVoiceForegroundResync({ room: deadRoom() as unknown as Room, state: createVoiceState(), actions })
      );

      await fireVisibilityChange();
      await advance(60_000);

      expect(actions.joinVoiceChannel).not.toHaveBeenCalled();
      expect(reconnectDispatches()).toHaveLength(0);
    });
  });

  describe('Electron wake from sleep', () => {
    it('runs the resync check when the system resumes', async () => {
      let emitResume: ((event: 'resume' | 'unlock-screen') => void) | undefined;
      const unsubscribe = vi.fn();
      const onSystemResume = vi.fn((callback: (event: 'resume' | 'unlock-screen') => void) => {
        emitResume = callback;
        return unsubscribe;
      });
      const room = createMockRoom({ canPlaybackAudio: false });
      const { unmount } = renderHook(
        () => useVoiceForegroundResync({ room: room as unknown as Room, state: createVoiceState(), actions: createActions() }),
        { wrapper: createElectronWrapper(createFakeElectronAPI({ onSystemResume })) },
      );

      expect(onSystemResume).toHaveBeenCalledTimes(1);
      await act(async () => {
        emitResume!('resume');
        await Promise.resolve();
      });
      expect(room.startAudio).toHaveBeenCalled();

      unmount();
      expect(unsubscribe).toHaveBeenCalled();
    });

    it('rejoins a call that died while the lid was closed', async () => {
      let emitResume: ((event: 'resume' | 'unlock-screen') => void) | undefined;
      const actions = createActions();
      renderHook(
        () => useVoiceForegroundResync({ room: deadRoom() as unknown as Room, state: createVoiceState(), actions }),
        {
          wrapper: createElectronWrapper(
            createFakeElectronAPI({
              onSystemResume: (callback: (event: 'resume' | 'unlock-screen') => void) => {
                emitResume = callback;
                return () => {};
              },
            }),
          ),
        },
      );

      await act(async () => {
        emitResume!('unlock-screen');
        await Promise.resolve();
      });
      await advance(REJOIN_BACKOFF_MS[0]);

      expect(actions.joinVoiceChannel).toHaveBeenCalledTimes(1);
    });

    it('works on older desktop builds without onSystemResume', () => {
      const api = createFakeElectronAPI();
      delete (api as Partial<typeof api>).onSystemResume;
      expect(() =>
        renderHook(
          () => useVoiceForegroundResync({ room: null, state: createVoiceState(), actions: createActions() }),
          { wrapper: createElectronWrapper(api) },
        )
      ).not.toThrow();
    });
  });
});
