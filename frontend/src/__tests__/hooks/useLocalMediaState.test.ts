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
// fetch the livekit chunk on every page load). Event/source names below are
// therefore plain string literals matching livekit-client's REAL runtime
// values (lowerCamelCase event names, snake_case-ish source names) rather
// than mocked enum members — mismatching them here would silently pass
// against a fake mock while failing against the real SDK.
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
      if (source === 'camera') return { isMuted: false, track: {} };
      if (source === 'microphone') return { isMuted: false, track: {} };
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
      emitRoomEvent('localTrackPublished', { source: 'camera', track: {} });
    });

    expect(result.current.isCameraEnabled).toBe(true);
  });

  it('updates on LocalTrackUnpublished for camera', () => {
    mockLocalParticipant.getTrackPublication.mockImplementation((source: string) => {
      if (source === 'camera') return { isMuted: false, track: {} };
      return null;
    });

    const { result } = renderUseLocalMediaState();
    expect(result.current.isCameraEnabled).toBe(true);

    act(() => {
      emitRoomEvent('localTrackUnpublished', { source: 'camera' });
    });

    expect(result.current.isCameraEnabled).toBe(false);
  });

  it('updates on TrackMuted for local participant only', () => {
    mockLocalParticipant.getTrackPublication.mockImplementation((source: string) => {
      if (source === 'microphone') return { isMuted: false, track: {} };
      return null;
    });

    const { result } = renderUseLocalMediaState();
    expect(result.current.isMicrophoneEnabled).toBe(true);

    // Mute by local participant
    act(() => {
      emitRoomEvent('trackMuted', { source: 'microphone' }, mockLocalParticipant);
    });

    expect(result.current.isMicrophoneEnabled).toBe(false);
  });

  it('ignores TrackMuted for remote participants', () => {
    mockLocalParticipant.getTrackPublication.mockImplementation((source: string) => {
      if (source === 'microphone') return { isMuted: false, track: {} };
      return null;
    });

    const { result } = renderUseLocalMediaState();
    expect(result.current.isMicrophoneEnabled).toBe(true);

    const remoteParticipant = { identity: 'other-user' };
    act(() => {
      emitRoomEvent('trackMuted', { source: 'microphone' }, remoteParticipant);
    });

    // Should still be true - ignored remote event
    expect(result.current.isMicrophoneEnabled).toBe(true);
  });

  it('cleans up listeners on unmount', () => {
    const { unmount } = renderUseLocalMediaState();

    unmount();

    expect(mockRoom.off).toHaveBeenCalledWith('localTrackPublished', expect.any(Function));
    expect(mockRoom.off).toHaveBeenCalledWith('localTrackUnpublished', expect.any(Function));
    expect(mockRoom.off).toHaveBeenCalledWith('trackMuted', expect.any(Function));
    expect(mockRoom.off).toHaveBeenCalledWith('trackUnmuted', expect.any(Function));
  });

  it('resets state when room becomes null', () => {
    mockLocalParticipant.getTrackPublication.mockImplementation((source: string) => {
      if (source === 'camera') return { isMuted: false, track: {} };
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
