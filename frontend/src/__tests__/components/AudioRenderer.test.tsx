import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { AudioRenderer } from '../../components/Voice/AudioRenderer';
import { TRACK_SOURCE } from '../../features/voice/livekitEvents';

// --- Event emitter helpers ---
type Handler = (...args: unknown[]) => void;
let roomEventHandlers: Map<string, Set<Handler>>;

// --- Mock audioBoostManager (real boostKey shape, spied applyVolume) ---
const { applyVolumeMock } = vi.hoisted(() => ({ applyVolumeMock: vi.fn() }));

vi.mock('../../features/voice/audioBoostManager', () => ({
  audioBoostManager: { applyVolume: applyVolumeMock },
  boostKey: (identity: string, source: string) => `${identity}:${source}`,
}));

// --- Mock track / participant factories ---
// Tracks include setVolume so isBoostableAudioTrack treats them as RemoteAudioTracks.
function createMockPublication(source: string, hasTrack = true) {
  return {
    source,
    trackSid: `sid-${source}-${Math.random()}`,
    track: hasTrack ? { attach: vi.fn(), detach: vi.fn(), setVolume: vi.fn() } : undefined,
  };
}

function createMockRemoteParticipant(
  identity: string,
  audioPublications: ReturnType<typeof createMockPublication>[] = [],
) {
  const audioMap = new Map<string, ReturnType<typeof createMockPublication>>();
  audioPublications.forEach((p, i) => audioMap.set(`audio-${i}`, p));

  return {
    identity,
    audioTrackPublications: audioMap,
  };
}

// --- Mock room ---
let mockRoom: {
  remoteParticipants: Map<string, ReturnType<typeof createMockRemoteParticipant>>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
} | null = null;

function buildMockRoom() {
  roomEventHandlers = new Map();

  const room = {
    remoteParticipants: new Map<string, ReturnType<typeof createMockRemoteParticipant>>(),
    on: vi.fn((event: string, handler: Handler) => {
      if (!roomEventHandlers.has(event)) roomEventHandlers.set(event, new Set());
      roomEventHandlers.get(event)!.add(handler);
      return room;
    }),
    off: vi.fn((event: string, handler: Handler) => {
      roomEventHandlers.get(event)?.delete(handler);
      return room;
    }),
  };

  mockRoom = room;
  return room;
}

// --- Mock livekit-client ---
//
// AudioRenderer.tsx no longer imports RoomEvent/Track as VALUES from
// 'livekit-client' — it uses the typed string constants in
// features/voice/livekitEvents.ts instead (see PR-11 "Fix round 1":
// AudioRenderer is always-mounted, so a runtime livekit-client import here
// would eagerly fetch the livekit chunk on every page load). This mock is
// therefore an empty stub; track-source literals below come from the real
// (unmocked) TRACK_SOURCE constants rather than a re-typed fake enum here.
vi.mock('livekit-client', () => ({}));

// --- Mock useRoom hook ---
vi.mock('../../hooks/useRoom', () => ({
  useRoom: vi.fn(() => ({ room: mockRoom })),
}));

// --- Mock useVoice hook ---
let mockWatchingScreenShares = new Set<string>();

vi.mock('../../contexts/VoiceContext', () => ({
  useVoice: vi.fn(() => ({ watchingScreenShares: mockWatchingScreenShares })),
}));

describe('AudioRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    buildMockRoom();
    mockWatchingScreenShares = new Set<string>();
  });

  it('renders nothing when there is no room', () => {
    mockRoom = null;
    const { container } = render(<AudioRenderer />);
    expect(container.innerHTML).toBe('');
  });

  it('renders audio elements for microphone tracks', () => {
    const micPub = createMockPublication(TRACK_SOURCE.Microphone);
    const participant = createMockRemoteParticipant('user-1', [micPub]);
    mockRoom!.remoteParticipants.set('user-1', participant);

    const { container } = render(<AudioRenderer />);
    const audioElements = container.querySelectorAll('audio');
    expect(audioElements.length).toBe(1);
  });

  it('renders screen share audio when watching that participant', () => {
    mockWatchingScreenShares = new Set(['user-1']);
    const screenAudioPub = createMockPublication(TRACK_SOURCE.ScreenShareAudio);
    const participant = createMockRemoteParticipant('user-1', [screenAudioPub]);
    mockRoom!.remoteParticipants.set('user-1', participant);

    const { container } = render(<AudioRenderer />);
    const audioElements = container.querySelectorAll('audio');
    expect(audioElements.length).toBe(1);
  });

  it('does NOT render screen share audio when NOT watching that participant', () => {
    mockWatchingScreenShares = new Set<string>();
    const screenAudioPub = createMockPublication(TRACK_SOURCE.ScreenShareAudio);
    const participant = createMockRemoteParticipant('user-1', [screenAudioPub]);
    mockRoom!.remoteParticipants.set('user-1', participant);

    const { container } = render(<AudioRenderer />);
    const audioElements = container.querySelectorAll('audio');
    expect(audioElements.length).toBe(0);
  });

  it('always renders soundboard tracks (Source.Unknown, matched by trackName)', () => {
    // Soundboard track: unknown source, identified by its name "soundboard"
    const soundboardPub = {
      source: TRACK_SOURCE.Unknown,
      trackName: 'soundboard',
      trackSid: 'sid-soundboard',
      track: { attach: vi.fn(), detach: vi.fn(), setVolume: vi.fn() },
    };
    const participant = createMockRemoteParticipant('user-1', [soundboardPub]);
    mockRoom!.remoteParticipants.set('user-1', participant);

    const { container } = render(<AudioRenderer />);
    const audioElements = container.querySelectorAll('audio');
    expect(audioElements.length).toBe(1);
  });

  it('renders screen share audio only for watched participants when multiple are present', () => {
    mockWatchingScreenShares = new Set(['user-1']);
    const screenAudioPub1 = createMockPublication(TRACK_SOURCE.ScreenShareAudio);
    const screenAudioPub2 = createMockPublication(TRACK_SOURCE.ScreenShareAudio);
    const participant1 = createMockRemoteParticipant('user-1', [screenAudioPub1]);
    const participant2 = createMockRemoteParticipant('user-2', [screenAudioPub2]);
    mockRoom!.remoteParticipants.set('user-1', participant1);
    mockRoom!.remoteParticipants.set('user-2', participant2);

    const { container } = render(<AudioRenderer />);
    const audioElements = container.querySelectorAll('audio');
    expect(audioElements.length).toBe(1);
  });

  it('renders both mic and screen share audio when watching participant', () => {
    mockWatchingScreenShares = new Set(['user-1']);
    const micPub = createMockPublication(TRACK_SOURCE.Microphone);
    const screenAudioPub = createMockPublication(TRACK_SOURCE.ScreenShareAudio);
    const participant = createMockRemoteParticipant('user-1', [micPub, screenAudioPub]);
    mockRoom!.remoteParticipants.set('user-1', participant);

    const { container } = render(<AudioRenderer />);
    const audioElements = container.querySelectorAll('audio');
    expect(audioElements.length).toBe(2);
  });

  it('renders only mic audio when not watching participant screen share', () => {
    mockWatchingScreenShares = new Set<string>();
    const micPub = createMockPublication(TRACK_SOURCE.Microphone);
    const screenAudioPub = createMockPublication(TRACK_SOURCE.ScreenShareAudio);
    const participant = createMockRemoteParticipant('user-1', [micPub, screenAudioPub]);
    mockRoom!.remoteParticipants.set('user-1', participant);

    const { container } = render(<AudioRenderer />);
    const audioElements = container.querySelectorAll('audio');
    expect(audioElements.length).toBe(1);
  });

  it('does not render audio for tracks without a track object', () => {
    const pubNoTrack = createMockPublication(TRACK_SOURCE.Microphone, false);
    const participant = createMockRemoteParticipant('user-1', [pubNoTrack]);
    mockRoom!.remoteParticipants.set('user-1', participant);

    const { container } = render(<AudioRenderer />);
    const audioElements = container.querySelectorAll('audio');
    expect(audioElements.length).toBe(0);
  });

  it('does not render audio elements for non-audio sources like camera', () => {
    const cameraPub = createMockPublication(TRACK_SOURCE.Camera);
    const participant = createMockRemoteParticipant('user-1', [cameraPub]);
    mockRoom!.remoteParticipants.set('user-1', participant);

    const { container } = render(<AudioRenderer />);
    const audioElements = container.querySelectorAll('audio');
    expect(audioElements.length).toBe(0);
  });

  describe('stored volume application after attach', () => {
    it('applies a stored volume of 0 (muted mic) after the track is attached', () => {
      // Stored as 0-2.0 float in localStorage; 0 means the user muted this stream
      localStorage.setItem('voiceUserVolume:user-1', '0');
      const micPub = createMockPublication(TRACK_SOURCE.Microphone);
      const participant = createMockRemoteParticipant('user-1', [micPub]);
      mockRoom!.remoteParticipants.set('user-1', participant);

      render(<AudioRenderer />);

      expect(applyVolumeMock).toHaveBeenCalledWith(micPub.track, 'user-1:microphone', 0);
      // Must run AFTER attach: RemoteAudioTrack.attach only re-applies truthy
      // volumes, so a pre-attach setVolume(0) never reaches the element.
      const attachOrder = micPub.track!.attach.mock.invocationCallOrder[0];
      const applyOrder = applyVolumeMock.mock.invocationCallOrder[0];
      expect(applyOrder).toBeGreaterThan(attachOrder);
    });

    it('applies a stored volume of 0 for screen share audio when watching', () => {
      mockWatchingScreenShares = new Set(['user-1']);
      localStorage.setItem('voiceScreenShareVolume:user-1', '0');
      const screenAudioPub = createMockPublication(TRACK_SOURCE.ScreenShareAudio);
      const participant = createMockRemoteParticipant('user-1', [screenAudioPub]);
      mockRoom!.remoteParticipants.set('user-1', participant);

      render(<AudioRenderer />);

      expect(applyVolumeMock).toHaveBeenCalledWith(
        screenAudioPub.track,
        'user-1:screen_share_audio',
        0,
      );
    });

    it('defaults to 100% when no volume is stored', () => {
      const micPub = createMockPublication(TRACK_SOURCE.Microphone);
      const participant = createMockRemoteParticipant('user-1', [micPub]);
      mockRoom!.remoteParticipants.set('user-1', participant);

      render(<AudioRenderer />);

      expect(applyVolumeMock).toHaveBeenCalledWith(micPub.track, 'user-1:microphone', 100);
    });

    it('applies a stored boosted volume (150%)', () => {
      localStorage.setItem('voiceUserVolume:user-1', '1.5');
      const micPub = createMockPublication(TRACK_SOURCE.Microphone);
      const participant = createMockRemoteParticipant('user-1', [micPub]);
      mockRoom!.remoteParticipants.set('user-1', participant);

      render(<AudioRenderer />);

      expect(applyVolumeMock).toHaveBeenCalledWith(micPub.track, 'user-1:microphone', 150);
    });
  });
});
