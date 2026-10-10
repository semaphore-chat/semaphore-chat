import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Room } from 'livekit-client';
import { useVoicePresenceHeartbeat, HEARTBEAT_RECONNECTING_GRACE_MS } from '../../hooks/useVoicePresenceHeartbeat';

// Mock SDK functions
const mockRefreshPresence = vi.fn().mockResolvedValue(undefined);
const mockRefreshDmPresence = vi.fn().mockResolvedValue(undefined);

vi.mock('../../api-client/sdk.gen', () => ({
  voicePresenceControllerRefreshPresence: (...args: unknown[]) => mockRefreshPresence(...args),
  dmVoicePresenceControllerRefreshDmPresence: (...args: unknown[]) => mockRefreshDmPresence(...args),
}));

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn() },
}));

// Mock VoiceSessionType enum
vi.mock('../../contexts/VoiceContext', () => ({
  VoiceSessionType: {
    Channel: 'channel',
    Dm: 'dm',
  },
}));

// Track worker instances
let lastWorkerInstance: {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
} | null = null;

// Variable to control whether Worker creation succeeds
let workerShouldFail = false;

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    if (workerShouldFail) {
      throw new Error('Worker not supported');
    }
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastWorkerInstance = this;
  }
}

// Replace global Worker with mock
const OriginalWorker = globalThis.Worker;

/** A LiveKit room stand-in: `state` plus captured event handlers. */
function createRoom(state: string) {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const room = {
    state,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    off: vi.fn(),
  };
  /** Change the state the way livekit does (state, then ConnectionStateChanged). */
  const setState = (next: string) => {
    room.state = next;
    handlers.connectionStateChanged?.(next);
  };
  return { room: room as unknown as Room, setState };
}

let liveRoom: Room;

describe('useVoicePresenceHeartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    lastWorkerInstance = null;
    workerShouldFail = false;
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    liveRoom = createRoom('connected').room;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.Worker = OriginalWorker;
  });

  it('should not start when no channel or DM is provided', () => {
    renderHook(() =>
      useVoicePresenceHeartbeat({
        channelId: null,
        dmGroupId: null,
        contextType: null,
        room: liveRoom,
      }),
    );

    expect(lastWorkerInstance).toBeNull();
    expect(mockRefreshPresence).not.toHaveBeenCalled();
  });

  it('should send heartbeat immediately on mount for channel', () => {
    renderHook(() =>
      useVoicePresenceHeartbeat({
        channelId: 'ch-1',
        dmGroupId: null,
        contextType: 'channel' as never,
        room: liveRoom,
      }),
    );

    expect(mockRefreshPresence).toHaveBeenCalledWith({
      path: { channelId: 'ch-1' },
    });
  });

  it('should send heartbeat immediately on mount for DM', () => {
    renderHook(() =>
      useVoicePresenceHeartbeat({
        channelId: null,
        dmGroupId: 'dm-1',
        contextType: 'dm' as never,
        room: liveRoom,
      }),
    );

    expect(mockRefreshDmPresence).toHaveBeenCalledWith({
      path: { dmGroupId: 'dm-1' },
    });
  });

  it('should create a worker with correct interval', () => {
    renderHook(() =>
      useVoicePresenceHeartbeat({
        channelId: 'ch-1',
        dmGroupId: null,
        contextType: 'channel' as never,
        room: liveRoom,
      }),
    );

    expect(lastWorkerInstance).not.toBeNull();
    expect(lastWorkerInstance!.postMessage).toHaveBeenCalledWith({
      type: 'start',
      name: 'heartbeat',
      interval: 30_000,
    });
  });

  it('should send heartbeat on worker tick', () => {
    renderHook(() =>
      useVoicePresenceHeartbeat({
        channelId: 'ch-1',
        dmGroupId: null,
        contextType: 'channel' as never,
        room: liveRoom,
      }),
    );

    // Clear the initial call
    mockRefreshPresence.mockClear();

    // Simulate worker tick
    lastWorkerInstance!.onmessage!({ data: { type: 'tick', name: 'heartbeat' } } as MessageEvent);

    expect(mockRefreshPresence).toHaveBeenCalledWith({
      path: { channelId: 'ch-1' },
    });
  });

  it('should ignore ticks for other timer names', () => {
    renderHook(() =>
      useVoicePresenceHeartbeat({
        channelId: 'ch-1',
        dmGroupId: null,
        contextType: 'channel' as never,
        room: liveRoom,
      }),
    );

    mockRefreshPresence.mockClear();

    // Simulate tick with wrong name
    lastWorkerInstance!.onmessage!({ data: { type: 'tick', name: 'other-timer' } } as MessageEvent);

    expect(mockRefreshPresence).not.toHaveBeenCalled();
  });

  it('should terminate worker on cleanup', () => {
    const { unmount } = renderHook(() =>
      useVoicePresenceHeartbeat({
        channelId: 'ch-1',
        dmGroupId: null,
        contextType: 'channel' as never,
        room: liveRoom,
      }),
    );

    const worker = lastWorkerInstance!;
    unmount();

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'stop',
      name: 'heartbeat',
    });
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('should fall back to setInterval when Worker is unavailable', () => {
    workerShouldFail = true;

    renderHook(() =>
      useVoicePresenceHeartbeat({
        channelId: 'ch-1',
        dmGroupId: null,
        contextType: 'channel' as never,
        room: liveRoom,
      }),
    );

    expect(lastWorkerInstance).toBeNull();

    // Initial call happened
    expect(mockRefreshPresence).toHaveBeenCalledTimes(1);
    mockRefreshPresence.mockClear();

    // Advance timer
    vi.advanceTimersByTime(30_000);

    expect(mockRefreshPresence).toHaveBeenCalledTimes(1);
  });

  it('should clean up setInterval fallback on unmount', () => {
    workerShouldFail = true;

    const { unmount } = renderHook(() =>
      useVoicePresenceHeartbeat({
        channelId: 'ch-1',
        dmGroupId: null,
        contextType: 'channel' as never,
        room: liveRoom,
      }),
    );

    mockRefreshPresence.mockClear();
    unmount();

    vi.advanceTimersByTime(60_000);
    expect(mockRefreshPresence).not.toHaveBeenCalled();
  });

  describe('room state (no ghost presence from a dead room)', () => {
    const tick = () =>
      lastWorkerInstance!.onmessage!({ data: { type: 'tick', name: 'heartbeat' } } as MessageEvent);

    it('does not start without a room', () => {
      renderHook(() =>
        useVoicePresenceHeartbeat({ channelId: 'ch-1', dmGroupId: null, contextType: 'channel' as never, room: null }),
      );
      expect(lastWorkerInstance).toBeNull();
      expect(mockRefreshPresence).not.toHaveBeenCalled();
    });

    it('stops sending once the room is disconnected', () => {
      const { room, setState } = createRoom('connected');
      renderHook(() =>
        useVoicePresenceHeartbeat({ channelId: 'ch-1', dmGroupId: null, contextType: 'channel' as never, room }),
      );
      expect(mockRefreshPresence).toHaveBeenCalledTimes(1);

      setState('disconnected');
      tick();
      tick();
      expect(mockRefreshPresence).toHaveBeenCalledTimes(1);
    });

    it('does not send for a room that is already dead on mount', () => {
      const { room } = createRoom('disconnected');
      renderHook(() =>
        useVoicePresenceHeartbeat({ channelId: 'ch-1', dmGroupId: null, contextType: 'channel' as never, room }),
      );
      tick();
      expect(mockRefreshPresence).not.toHaveBeenCalled();
    });

    it('keeps sending while briefly reconnecting, then stops after the grace period', () => {
      const { room, setState } = createRoom('connected');
      renderHook(() =>
        useVoicePresenceHeartbeat({ channelId: 'ch-1', dmGroupId: null, contextType: 'channel' as never, room }),
      );
      mockRefreshPresence.mockClear();

      setState('reconnecting');
      tick();
      expect(mockRefreshPresence).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(HEARTBEAT_RECONNECTING_GRACE_MS);
      tick();
      expect(mockRefreshPresence).toHaveBeenCalledTimes(1);

      // Reconnected: heartbeats resume
      setState('connected');
      tick();
      expect(mockRefreshPresence).toHaveBeenCalledTimes(2);
    });
  });
});
