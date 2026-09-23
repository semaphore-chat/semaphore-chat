import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFloatTileSelection } from '../../hooks/useFloatTileSelection';

// Verifies the hook's room-event wiring itself (which events force
// recomputation), complementing useFloatTileSelection.test.ts's pure
// selectFloatTile coverage. Mocks livekit-client because we need to emit
// RoomEvent.TrackMuted/TrackUnmuted/LocalTrackPublished/LocalTrackUnpublished
// through the same string keys the hook subscribes with.

type Handler = (...args: unknown[]) => void;
let roomEventHandlers: Map<string, Set<Handler>>;

function emit(event: string, ...args: unknown[]) {
  roomEventHandlers.get(event)?.forEach((h) => h(...args));
}

vi.mock('livekit-client', () => ({
  RoomEvent: {
    ActiveSpeakersChanged: 'activeSpeakersChanged',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    TrackMuted: 'trackMuted',
    TrackUnmuted: 'trackUnmuted',
    LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished',
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
  },
  Track: {
    Source: {
      Camera: 'camera',
      ScreenShare: 'screen_share',
    },
  },
}));

let mockRoom: {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  localParticipant: unknown;
  remoteParticipants: Map<string, unknown>;
} | null = null;

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: vi.fn(() => ({ state: { room: mockRoom } })),
}));

vi.mock('../../contexts/VoiceContext', () => ({
  useVoice: vi.fn(() => ({ watchingScreenShares: new Set<string>() })),
}));

interface StubPublication {
  source: string;
  isMuted: boolean;
  isSubscribed: boolean;
}

function makePublication(isMuted: boolean): StubPublication {
  return { source: 'camera', isMuted, isSubscribed: true };
}

function buildRoom(cameraPub: StubPublication | undefined) {
  roomEventHandlers = new Map();
  const remoteParticipant = {
    identity: 'speaker-1',
    getTrackPublication: (source: string) => (source === 'camera' ? cameraPub : undefined),
  };
  return {
    on: vi.fn((event: string, handler: Handler) => {
      if (!roomEventHandlers.has(event)) roomEventHandlers.set(event, new Set());
      roomEventHandlers.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      roomEventHandlers.get(event)?.delete(handler);
    }),
    localParticipant: { identity: 'local-user', getTrackPublication: () => undefined },
    remoteParticipants: new Map([['speaker-1', remoteParticipant]]),
  };
}

describe('useFloatTileSelection room event wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoom = null;
  });

  it('drops a stale camera selection when the participant mutes their camera (TrackMuted)', () => {
    const cameraPub = makePublication(false);
    mockRoom = buildRoom(cameraPub);

    const { result, rerender } = renderHook(() => useFloatTileSelection());

    // Selection picks up the remote camera via the fallback "first participant
    // with a live camera" path since there are no active speakers.
    expect(result.current?.kind).toBe('camera');

    // Publication mutes in place (as livekit-client does), then the room fires
    // TrackMuted for it — the hook must recompute rather than keep rendering
    // the now-dead publication.
    cameraPub.isMuted = true;
    act(() => {
      emit('trackMuted', cameraPub, mockRoom!.remoteParticipants.get('speaker-1'));
    });
    rerender();

    expect(result.current?.kind).toBe('avatar');
  });

  it('picks up a newly live camera after unmute (TrackUnmuted)', () => {
    const cameraPub = makePublication(true);
    mockRoom = buildRoom(cameraPub);

    const { result, rerender } = renderHook(() => useFloatTileSelection());

    expect(result.current?.kind).toBe('avatar');

    cameraPub.isMuted = false;
    act(() => {
      emit('trackUnmuted', cameraPub, mockRoom!.remoteParticipants.get('speaker-1'));
    });
    rerender();

    expect(result.current?.kind).toBe('camera');
  });

  it('picks up the local participant turning their camera on (LocalTrackPublished)', () => {
    mockRoom = buildRoom(undefined);
    // No publication yet — mirrors the local participant not having published
    // a camera track at mount. Mutated (not reassigned) below so the closure
    // reads the latest value.
    const localCamera: { pub?: StubPublication } = {};
    mockRoom.localParticipant = {
      identity: 'local-user',
      getTrackPublication: (source: string) => (source === 'camera' ? localCamera.pub : undefined),
    };

    const { result, rerender } = renderHook(() => useFloatTileSelection());

    expect(result.current?.kind).toBe('avatar');

    // The publish call resolves and the publication now exists.
    localCamera.pub = makePublication(false);
    act(() => {
      emit('localTrackPublished', { source: 'camera' }, mockRoom!.localParticipant);
    });
    rerender();

    expect(result.current).toEqual({
      kind: 'camera',
      participant: mockRoom!.localParticipant,
      publication: localCamera.pub,
    });
  });

  it('drops the local camera selection after LocalTrackUnpublished', () => {
    mockRoom = buildRoom(undefined);
    let localCameraPub: StubPublication | undefined = makePublication(false);
    mockRoom.localParticipant = {
      identity: 'local-user',
      getTrackPublication: (source: string) => (source === 'camera' ? localCameraPub : undefined),
    };

    const { result, rerender } = renderHook(() => useFloatTileSelection());

    expect(result.current?.kind).toBe('camera');

    localCameraPub = undefined;
    act(() => {
      emit('localTrackUnpublished', { source: 'camera' }, mockRoom!.localParticipant);
    });
    rerender();

    expect(result.current?.kind).toBe('avatar');
  });
});
