import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createTestWrapper, createTestQueryClient } from '../test-utils';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// Create a mock room with event emitter behavior
type Handler = (...args: unknown[]) => void;
const eventHandlers = new Map<string, Set<Handler>>();

const mockLocalParticipant = {
  identity: 'user-1',
  getTrackPublication: vi.fn().mockReturnValue(null),
};

const mockRoom = {
  localParticipant: mockLocalParticipant,
  on: vi.fn((event: string, handler: Handler) => {
    if (!eventHandlers.has(event)) eventHandlers.set(event, new Set());
    eventHandlers.get(event)!.add(handler);
    return mockRoom;
  }),
  off: vi.fn((event: string, handler: Handler) => {
    eventHandlers.get(event)?.delete(handler);
    return mockRoom;
  }),
};

function emitRoomEvent(event: string, ...args: unknown[]) {
  eventHandlers.get(event)?.forEach(h => h(...args));
}

let currentRoom: typeof mockRoom | null = mockRoom;

vi.mock('../../hooks/useRoom', () => ({
  useRoom: () => ({ room: currentRoom, setRoom: vi.fn(), getRoom: vi.fn() }),
}));

// The source (useLocalMediaState.ts) no longer imports RoomEvent/Track as
// VALUES from 'livekit-client' — it uses the typed string constants in
// features/voice/livekitEvents.ts instead (see PR-11 "Fix round 1": this
// hook is statically reachable from mobile's always-mounted
// MobileChatPanel, so a runtime livekit-client import here would eagerly
// fetch the livekit chunk on every page load). Event/source names below
// therefore come from the REAL (unmocked) ROOM_EVENT/TRACK_SOURCE constants
// in livekitEvents.ts — not from 'livekit-client' itself (still mocked
// below) and not re-typed as ad hoc literals here. livekitEvents.ts's own
// constants are independently pinned against the real SDK's enum types via
// `satisfies` (see that file), so importing them here keeps this test
// pinned to the same source of truth as the hook, without reintroducing the
// "fake mock enum silently drifts from the real SDK" risk this comment used
// to warn about.
vi.mock('livekit-client', () => ({
  LocalAudioTrack: class {},
  LocalVideoTrack: class {},
  LocalTrackPublication: class {},
  TrackPublication: class {},
  Participant: class {},
}));

vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useLocalMediaState } from '../../hooks/useLocalMediaState';
import { ROOM_EVENT, TRACK_SOURCE } from '../../features/voice/livekitEvents';

describe('useLocalMediaState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers.clear();
    currentRoom = mockRoom;
    mockLocalParticipant.getTrackPublication.mockReturnValue(null);
  });

  function renderUseLocalMediaState() {
    const queryClient = createTestQueryClient();
    return renderHook(() => useLocalMediaState(), {
      wrapper: createTestWrapper({ queryClient }),
    });
  }

  it('all false when no room', () => {
    currentRoom = null;
    const { result } = renderUseLocalMediaState();

    expect(result.current.isCameraEnabled).toBe(false);
    expect(result.current.isMicrophoneEnabled).toBe(false);
    expect(result.current.isScreenShareEnabled).toBe(false);
  });

  it('initializes from existing track publications', () => {
    mockLocalParticipant.getTrackPublication.mockImplementation((source: string) => {
      if (source === TRACK_SOURCE.Camera) return { isMuted: false, track: {} };
      if (source === TRACK_SOURCE.Microphone) return { isMuted: false, track: {} };
      return null;
    });

    const { result } = renderUseLocalMediaState();

    expect(result.current.isCameraEnabled).toBe(true);
    expect(result.current.isMicrophoneEnabled).toBe(true);
    expect(result.current.isScreenShareEnabled).toBe(false);
  });

  it('updates on LocalTrackPublished for camera', () => {
    const { result } = renderUseLocalMediaState();

    act(() => {
      emitRoomEvent(ROOM_EVENT.LocalTrackPublished, { source: TRACK_SOURCE.Camera, track: {} });
    });

    expect(result.current.isCameraEnabled).toBe(true);
  });

  it('updates on LocalTrackUnpublished for camera', () => {
    mockLocalParticipant.getTrackPublication.mockImplementation((source: string) => {
      if (source === TRACK_SOURCE.Camera) return { isMuted: false, track: {} };
      return null;
    });

    const { result } = renderUseLocalMediaState();
    expect(result.current.isCameraEnabled).toBe(true);

    act(() => {
      emitRoomEvent(ROOM_EVENT.LocalTrackUnpublished, { source: TRACK_SOURCE.Camera });
    });

    expect(result.current.isCameraEnabled).toBe(false);
  });

  it('updates on TrackMuted for local participant only', () => {
    mockLocalParticipant.getTrackPublication.mockImplementation((source: string) => {
      if (source === TRACK_SOURCE.Microphone) return { isMuted: false, track: {} };
      return null;
    });

    const { result } = renderUseLocalMediaState();
    expect(result.current.isMicrophoneEnabled).toBe(true);

    // Mute by local participant
    act(() => {
      emitRoomEvent(ROOM_EVENT.TrackMuted, { source: TRACK_SOURCE.Microphone }, mockLocalParticipant);
    });

    expect(result.current.isMicrophoneEnabled).toBe(false);
  });

  it('ignores TrackMuted for remote participants', () => {
    mockLocalParticipant.getTrackPublication.mockImplementation((source: string) => {
      if (source === TRACK_SOURCE.Microphone) return { isMuted: false, track: {} };
      return null;
    });

    const { result } = renderUseLocalMediaState();
    expect(result.current.isMicrophoneEnabled).toBe(true);

    const remoteParticipant = { identity: 'other-user' };
    act(() => {
      emitRoomEvent(ROOM_EVENT.TrackMuted, { source: TRACK_SOURCE.Microphone }, remoteParticipant);
    });

    // Should still be true - ignored remote event
    expect(result.current.isMicrophoneEnabled).toBe(true);
  });

  it('cleans up listeners on unmount', () => {
    const { unmount } = renderUseLocalMediaState();

    unmount();

    expect(mockRoom.off).toHaveBeenCalledWith(ROOM_EVENT.LocalTrackPublished, expect.any(Function));
    expect(mockRoom.off).toHaveBeenCalledWith(ROOM_EVENT.LocalTrackUnpublished, expect.any(Function));
    expect(mockRoom.off).toHaveBeenCalledWith(ROOM_EVENT.TrackMuted, expect.any(Function));
    expect(mockRoom.off).toHaveBeenCalledWith(ROOM_EVENT.TrackUnmuted, expect.any(Function));
  });

  it('resets state when room becomes null', () => {
    mockLocalParticipant.getTrackPublication.mockImplementation((source: string) => {
      if (source === TRACK_SOURCE.Camera) return { isMuted: false, track: {} };
      return null;
    });

    const { result, rerender } = renderUseLocalMediaState();
    expect(result.current.isCameraEnabled).toBe(true);

    // Simulate room going null
    currentRoom = null;
    rerender();

    expect(result.current.isCameraEnabled).toBe(false);
    expect(result.current.isMicrophoneEnabled).toBe(false);
  });
});
