/**
 * useSoundboardWarmup: the one owner of the soundboard warm-up (VoiceSessionEffects). These tests use
 * the real soundboardPlayer (WebAudio and the LiveKit room are faked), so "publishes once" is counted at
 * `localParticipant.publishTrack`, the call peers would see.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { TrackSource } from '@livekit/protocol';
import { soundboardGrantAllows, useSoundboardWarmup } from '../../hooks/useSoundboardWarmup';
import { soundboardPlayer, SOUNDBOARD_TRACK_NAME } from '../../features/voice/soundboardPlayer';
import { PROTO_TRACK_SOURCE_UNKNOWN, type ParticipantPermission } from '../../features/voice/livekitEvents';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { useVoiceConnection } from '../../hooks/useVoiceConnection';

vi.mock('../../hooks/useVoiceConnection', () => ({ useVoiceConnection: vi.fn() }));

// --- WebAudio (jsdom has none) ---
class FakeAudioContext {
  state = 'running';
  destination = {};
  createMediaStreamDestination() {
    return { stream: { getAudioTracks: () => [{ id: 'sb-track' }] } };
  }
  createBufferSource() {
    return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
  }
  decodeAudioData() {
    return Promise.resolve({ duration: 1 });
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

// --- A LiveKit room's local participant: publications, a grant, and its permission event ---
const PERMISSIONS_CHANGED = 'participantPermissionsChanged';
const TRACK_EVENTS = ['localTrackPublished', 'localTrackUnpublished'];
const FULL: ParticipantPermission = { canPublish: true, canPublishSources: [] } as unknown as ParticipantPermission;
const grant = (canPublish: boolean, sources: TrackSource[]) =>
  ({ canPublish, canPublishSources: sources }) as unknown as ParticipantPermission;
/** What a server-muted or restricted member's token carries: no UNKNOWN. */
const NO_SOUNDBOARD = grant(true, [TrackSource.CAMERA, TrackSource.SCREEN_SHARE]);
const RESTRICTED_FULL = grant(true, [TrackSource.MICROPHONE, TrackSource.UNKNOWN]);

interface Deferred {
  resolve(): void;
  reject(error: Error): void;
}

/** `createRoom()`: a full grant. `createRoom(undefined)`: no grant on the participant at all. */
function createRoom(...args: [permissions?: ParticipantPermission | undefined]) {
  const permissions = args.length > 0 ? args[0] : FULL;
  const listeners = new Set<() => void>();
  const trackListeners = new Set<() => void>();
  const publications = new Map<string, { trackSid: string; trackName: string; source?: string; track: unknown }>();
  let sid = 0;
  /** When set, publishes wait until the test settles them. */
  let manual = false;
  const waiting: Deferred[] = [];
  const publishTrack = vi.fn((track: unknown, opts: { name: string }) => {
    const publication = { trackSid: `sid-${++sid}`, trackName: opts.name, source: 'unknown', track: { mediaStreamTrack: track } };
    const done = () => {
      publications.set(publication.trackSid, publication);
      trackListeners.forEach((listener) => listener());
      return publication;
    };
    if (!manual) return Promise.resolve(done());
    return new Promise((resolve, reject) => {
      waiting.push({ resolve: () => resolve(done()), reject });
    });
  });
  const unpublishTrack = vi.fn(async (track: unknown) => {
    for (const [key, publication] of publications) if (publication.track === track) publications.delete(key);
  });
  const localParticipant = {
    permissions,
    trackPublications: publications,
    publishTrack,
    unpublishTrack,
    on: vi.fn((event: string, listener: () => void) => {
      if (event === PERMISSIONS_CHANGED) listeners.add(listener);
      if (TRACK_EVENTS.includes(event)) trackListeners.add(listener);
      return localParticipant;
    }),
    off: vi.fn((event: string, listener: () => void) => {
      if (event === PERMISSIONS_CHANGED) listeners.delete(listener);
      if (TRACK_EVENTS.includes(event)) trackListeners.delete(listener);
      return localParticipant;
    }),
  };
  return {
    room: { localParticipant },
    publishTrack,
    unpublishTrack,
    publications,
    listeners,
    trackListeners,
    holdPublishes() {
      manual = true;
    },
    waiting,
    /** The server changes the grant (setPermissions → participantPermissionsChanged). */
    setPermissions(next: ParticipantPermission | undefined) {
      localParticipant.permissions = next;
      listeners.forEach((listener) => listener());
    },
    /** The server takes the soundboard track down with the grant. */
    serverUnpublishSoundboard() {
      for (const [key, publication] of publications) {
        if (publication.trackName === SOUNDBOARD_TRACK_NAME) publications.delete(key);
      }
      trackListeners.forEach((listener) => listener());
    },
    /** The user's mic is published (join with the mic on, or an unmute after a server mute). */
    publishMic() {
      const publication = { trackSid: `sid-${++sid}`, trackName: 'microphone', source: 'microphone', track: {} };
      publications.set(publication.trackSid, publication);
      trackListeners.forEach((listener) => listener());
    },
    /** A server mute takes the mic down with the grant. */
    serverUnpublishMic() {
      for (const [key, publication] of publications) {
        if (publication.source === 'microphone') publications.delete(key);
      }
      trackListeners.forEach((listener) => listener());
    },
    /** A full reconnect republishes the local tracks under new sids. */
    republishUnderNewSids() {
      const all = [...publications.values()];
      publications.clear();
      // New publication objects with new sids, as LiveKit's republish creates them.
      for (const publication of all) {
        const again = { ...publication, trackSid: `sid-${++sid}` };
        publications.set(again.trackSid, again);
      }
    },
  };
}

type FakeRoom = ReturnType<typeof createRoom>;

interface CallState {
  room: FakeRoom['room'] | null;
  isConnected: boolean;
  contextType: VoiceSessionType | null;
  communityId: string | null;
  isServerMuted: boolean;
}

const communityCall = (room: FakeRoom, overrides: Partial<CallState> = {}): CallState => ({
  room: room.room,
  isConnected: true,
  contextType: VoiceSessionType.Channel,
  communityId: 'c-1',
  isServerMuted: false,
  ...overrides,
});

let call: CallState;
function setCall(next: CallState) {
  call = next;
  vi.mocked(useVoiceConnection).mockImplementation(() => ({ state: call, actions: {} }) as never);
}

function mount(options: { canSpeak?: boolean; strict?: boolean } = {}) {
  const { canSpeak = true, strict = false } = options;
  return renderHook(({ speak }) => useSoundboardWarmup({ canSpeak: speak }), {
    initialProps: { speak: canSpeak },
    reactStrictMode: strict,
  });
}

/** Lets the player's promise chains run. */
const flush = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
});

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(async () => {
  await soundboardPlayer.dispose(null);
  vi.unstubAllGlobals();
  vi.mocked(useVoiceConnection).mockReset();
});

describe('soundboardGrantAllows', () => {
  it('is false with no grant known (a participant before its join response)', () => {
    expect(soundboardGrantAllows(undefined)).toBe(false);
  });

  it('is true for a grant with no source list (every source)', () => {
    expect(soundboardGrantAllows(FULL)).toBe(true);
  });

  it('is true for a source list that names UNKNOWN, false for one that does not', () => {
    expect(soundboardGrantAllows(RESTRICTED_FULL)).toBe(true);
    expect(soundboardGrantAllows(NO_SOUNDBOARD)).toBe(false);
  });

  it('is false when publishing is not allowed at all, whatever the list says', () => {
    expect(soundboardGrantAllows(grant(false, []))).toBe(false);
    expect(soundboardGrantAllows(grant(false, [TrackSource.UNKNOWN]))).toBe(false);
  });

  it("PROTO_TRACK_SOURCE_UNKNOWN is @livekit/protocol's TrackSource.UNKNOWN", () => {
    expect(PROTO_TRACK_SOURCE_UNKNOWN).toBe(TrackSource.UNKNOWN);
  });
});

describe('useSoundboardWarmup', () => {
  it('publishes the soundboard track once a community call is connected', async () => {
    const room = createRoom();
    setCall(communityCall(room));
    mount();
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);
    expect(room.publishTrack.mock.calls[0][1]).toMatchObject({ name: SOUNDBOARD_TRACK_NAME });
  });

  it('does nothing before the call is connected (the room exists while the mic is set up)', async () => {
    const room = createRoom();
    setCall(communityCall(room, { isConnected: false }));
    const { rerender } = mount();
    await flush();
    expect(room.publishTrack).not.toHaveBeenCalled();
    setCall(communityCall(room));
    rerender({ speak: true });
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);
  });

  it('never warms a DM call', async () => {
    const room = createRoom();
    setCall(communityCall(room, { contextType: VoiceSessionType.Dm, communityId: null }));
    mount();
    await flush();
    expect(room.publishTrack).not.toHaveBeenCalled();
  });

  it('a StrictMode double mount publishes once (#803)', async () => {
    const room = createRoom();
    room.holdPublishes();
    setCall(communityCall(room));
    const warmup = vi.spyOn(soundboardPlayer, 'warmup');
    mount({ strict: true });
    await flush();
    // StrictMode ran the effect twice: two warm-ups, one publish.
    expect(warmup.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(room.publishTrack).toHaveBeenCalledTimes(1);
    warmup.mockRestore();
    await act(async () => room.waiting.forEach((publish) => publish.resolve()));
    await flush();
    expect(room.publications.size).toBe(1);
  });

  it('a warm-up racing the first play publishes once, and the clip plays', async () => {
    const room = createRoom();
    room.holdPublishes();
    setCall(communityCall(room));
    mount();
    await flush();
    let played = false;
    const play = soundboardPlayer.play(room.room as never, 'file-1', new ArrayBuffer(8)).then(() => {
      played = true;
    });
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);
    expect(played).toBe(false);
    await act(async () => room.waiting.forEach((publish) => publish.resolve()));
    await act(async () => play);
    expect(played).toBe(true);
    expect(room.publishTrack).toHaveBeenCalledTimes(1);
  });

  it('a user who joins server-muted publishes nothing until the mute is lifted', async () => {
    const room = createRoom(NO_SOUNDBOARD);
    setCall(communityCall(room, { isServerMuted: true }));
    const { rerender } = mount();
    await flush();
    expect(room.publishTrack).not.toHaveBeenCalled();
    // The moderator lifts the mute: the server restores the grant, and the socket event clears the flag.
    act(() => room.setPermissions(FULL));
    setCall(communityCall(room, { isServerMuted: false }));
    rerender({ speak: true });
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);
  });

  it('a grant without UNKNOWN holds the warm-up even when the mute flag is not set yet', async () => {
    const room = createRoom(NO_SOUNDBOARD);
    setCall(communityCall(room));
    mount();
    await flush();
    expect(room.publishTrack).not.toHaveBeenCalled();
  });

  it("a restricted member's warm-up waits for the webhook's grant, then runs on participantPermissionsChanged", async () => {
    // The JWT of a member without video or share lists sources and cannot carry UNKNOWN.
    const room = createRoom(grant(true, [TrackSource.MICROPHONE]));
    setCall(communityCall(room));
    mount();
    await flush();
    expect(room.publishTrack).not.toHaveBeenCalled();
    act(() => room.setPermissions(RESTRICTED_FULL));
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);
  });

  it('a mute after the warm-up, then the mute lifted: the soundboard comes back only once the mic is published again', async () => {
    const room = createRoom();
    room.publishMic();
    setCall(communityCall(room));
    const { rerender } = mount();
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);

    // Muted: the grant loses MICROPHONE and UNKNOWN, the server unpublishes the mic and the soundboard track.
    act(() => {
      room.serverUnpublishSoundboard();
      room.serverUnpublishMic();
      room.setPermissions(NO_SOUNDBOARD);
    });
    setCall(communityCall(room, { isServerMuted: true }));
    rerender({ speak: true });
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);

    // Lifted: the grant is back, but the user has not unmuted yet. Publishing now would race the mic's republish
    // (two audio publishes in flight can land under one track on the server), so nothing yet.
    act(() => room.setPermissions(FULL));
    setCall(communityCall(room, { isServerMuted: false }));
    rerender({ speak: true });
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);

    // The user unmutes: the mic is published, then the soundboard follows.
    act(() => room.publishMic());
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(2);
    const soundboards = [...room.publications.values()].filter((p) => p.trackName === SOUNDBOARD_TRACK_NAME);
    expect(soundboards).toHaveLength(1);
  });

  it('a user who joined muted (no mic published yet) warms up at once, and after a lifted mute too', async () => {
    const room = createRoom();
    setCall(communityCall(room));
    const { rerender } = mount();
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);

    act(() => {
      room.serverUnpublishSoundboard();
      room.setPermissions(NO_SOUNDBOARD);
    });
    setCall(communityCall(room, { isServerMuted: true }));
    rerender({ speak: true });
    await flush();
    act(() => room.setPermissions(FULL));
    setCall(communityCall(room, { isServerMuted: false }));
    rerender({ speak: true });
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(2);
  });

  it('a local mute keeps the mic published: nothing waits and nothing is published again', async () => {
    const room = createRoom();
    room.publishMic();
    setCall(communityCall(room));
    mount();
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);
    // A local mute only mutes the track (the publication stays); an unrelated track event fires.
    act(() => room.trackListeners.forEach((listener) => listener()));
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);
  });

  it('a timed-out member (no speak) publishes nothing', async () => {
    const room = createRoom();
    setCall(communityCall(room));
    mount({ canSpeak: false });
    await flush();
    expect(room.publishTrack).not.toHaveBeenCalled();
  });

  it('no permissions object on the participant: never warms (play still publishes lazily)', async () => {
    const room = createRoom(undefined);
    setCall(communityCall(room));
    mount();
    await flush();
    expect(room.publishTrack).not.toHaveBeenCalled();
    await act(() => soundboardPlayer.play(room.room as never, 'file-1', new ArrayBuffer(8)));
    expect(room.publishTrack).toHaveBeenCalledTimes(1);
  });

  it('a reconnect that republishes under new sids publishes no second soundboard track', async () => {
    const room = createRoom();
    setCall(communityCall(room));
    mount();
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);
    act(() => {
      room.republishUnderNewSids();
      // The rejoin's participant update re-sends the grant (no change, but a fresh object).
      room.setPermissions(grant(true, []));
    });
    await flush();
    await act(() => soundboardPlayer.play(room.room as never, 'file-1', new ArrayBuffer(8)));
    expect(room.publishTrack).toHaveBeenCalledTimes(1);
    expect(room.publications.size).toBe(1);
  });

  it('leaving mid-publish takes the late track down and keeps nothing for the next call', async () => {
    const room = createRoom();
    room.holdPublishes();
    setCall(communityCall(room));
    const { unmount } = mount();
    await flush();
    expect(room.publishTrack).toHaveBeenCalledTimes(1);

    // Leave: the leave action disposes the player, the call state ends, the effects unmount.
    await act(() => soundboardPlayer.dispose(room.room as never));
    unmount();
    await act(async () => room.waiting.forEach((publish) => publish.resolve()));
    await flush();
    expect(room.unpublishTrack).toHaveBeenCalledTimes(1);
    expect(room.publications.size).toBe(0);

    // The next call publishes afresh.
    const next = createRoom();
    setCall(communityCall(next));
    mount();
    await flush();
    expect(next.publishTrack).toHaveBeenCalledTimes(1);
  });

  it('stops listening for grant changes when the call ends', async () => {
    const room = createRoom();
    setCall(communityCall(room));
    const { unmount } = mount();
    await flush();
    expect(room.listeners.size).toBe(1);
    expect(room.trackListeners.size).toBe(1);
    unmount();
    expect(room.listeners.size).toBe(0);
    expect(room.trackListeners.size).toBe(0);
  });
});
