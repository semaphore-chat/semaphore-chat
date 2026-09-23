import { describe, it, expect } from 'vitest';
import { selectFloatTile } from '../../hooks/useFloatTileSelection';

// selectFloatTile is imported from the same module as the (unused-here)
// useFloatTileSelection hook, which pulls in the real livekit-client chain
// (via useVoiceConnection -> voiceActions -> livekitWorkerTimers). The real
// module's Track.Source values ('camera' / 'screen_share') are what the stub
// participants below compare against, so no livekit-client mock is needed.

interface StubPublication {
  source: string;
  isMuted: boolean;
  isSubscribed: boolean;
}

// Defaults to subscribed=true: most cases below represent a publication that's
// already watched/gridded. Regression cases for the "never watched" gap pass
// isSubscribed: false explicitly.
function publication(
  source: 'camera' | 'screen_share',
  isMuted = false,
  isSubscribed = true,
): StubPublication {
  return { source, isMuted, isSubscribed };
}

function createParticipant(
  identity: string,
  publications: Partial<Record<'camera' | 'screen_share', StubPublication | undefined>> = {},
) {
  return {
    identity,
    name: identity,
    getTrackPublication: (source: string) =>
      source === 'camera' ? publications.camera : publications.screen_share,
  };
}

type StubParticipant = ReturnType<typeof createParticipant>;

function createRoom(localParticipant: StubParticipant, remote: StubParticipant[] = []) {
  return {
    localParticipant,
    remoteParticipants: new Map(remote.map((p) => [p.identity, p])),
  } as unknown as Parameters<typeof selectFloatTile>[0];
}

describe('selectFloatTile', () => {
  it('returns null when there is no room', () => {
    expect(selectFloatTile(null, new Set(), [])).toBeNull();
  });

  it('prefers a watched screen share belonging to an active speaker over the active speaker\'s camera', () => {
    const local = createParticipant('local-user');
    const speakerWithCamera = createParticipant('speaker-1', { camera: publication('camera') });
    const screenSharer = createParticipant('sharer-1', { screen_share: publication('screen_share') });
    const room = createRoom(local, [speakerWithCamera, screenSharer]);

    const result = selectFloatTile(
      room,
      new Set(['sharer-1']),
      [speakerWithCamera as unknown as never, screenSharer as unknown as never],
    );

    expect(result).toEqual({
      kind: 'screen',
      participant: screenSharer,
      publication: publication('screen_share'),
    });
  });

  it('falls back to the first watched screen share with a live publication when none belongs to an active speaker', () => {
    const local = createParticipant('local-user');
    const idleSharer = createParticipant('sharer-idle', { screen_share: publication('screen_share') });
    const room = createRoom(local, [idleSharer]);

    const result = selectFloatTile(room, new Set(['sharer-idle']), []);

    expect(result?.kind).toBe('screen');
    expect(result?.participant).toBe(idleSharer);
  });

  it('never selects an unwatched screen share, even if the sharer is speaking', () => {
    const local = createParticipant('local-user');
    const sharer = createParticipant('sharer-1', {
      screen_share: publication('screen_share'),
      camera: publication('camera'),
    });
    const room = createRoom(local, [sharer]);

    // sharer-1 is not in watchingScreenShares — the screen share must be skipped
    const result = selectFloatTile(room, new Set(), [sharer as unknown as never]);

    expect(result?.kind).toBe('camera');
    expect(result?.participant).toBe(sharer);
  });

  it('selects the active speaker\'s camera when no watched screen share is live', () => {
    const local = createParticipant('local-user');
    const speaker = createParticipant('speaker-1', { camera: publication('camera') });
    const other = createParticipant('other-1', { camera: publication('camera') });
    const room = createRoom(local, [speaker, other]);

    const result = selectFloatTile(room, new Set(), [speaker as unknown as never, other as unknown as never]);

    expect(result).toEqual({ kind: 'camera', participant: speaker, publication: publication('camera') });
  });

  it('falls back to the next active speaker with a camera when the top speaker has none', () => {
    const local = createParticipant('local-user');
    const topSpeakerNoCamera = createParticipant('speaker-1');
    const secondSpeakerWithCamera = createParticipant('speaker-2', { camera: publication('camera') });
    const room = createRoom(local, [topSpeakerNoCamera, secondSpeakerWithCamera]);

    const result = selectFloatTile(
      room,
      new Set(),
      [topSpeakerNoCamera as unknown as never, secondSpeakerWithCamera as unknown as never],
    );

    expect(result?.kind).toBe('camera');
    expect(result?.participant).toBe(secondSpeakerWithCamera);
  });

  it('falls back to the first remote/local participant with a camera when nobody is an active speaker', () => {
    const local = createParticipant('local-user');
    const camUser = createParticipant('cam-user', { camera: publication('camera') });
    const room = createRoom(local, [camUser]);

    const result = selectFloatTile(room, new Set(), []);

    expect(result?.kind).toBe('camera');
    expect(result?.participant).toBe(camUser);
  });

  it('falls back to avatar when the active speaker has a live camera publication that was never watched/subscribed', () => {
    const local = createParticipant('local-user');
    // Camera exists and is unmuted, but isSubscribed: false — e.g. a fresh float
    // session where the full VideoTiles grid was never opened to opt in.
    const speaker = createParticipant('speaker-1', { camera: publication('camera', false, false) });
    const room = createRoom(local, [speaker]);

    const result = selectFloatTile(room, new Set(), [speaker as unknown as never]);

    expect(result).toEqual({ kind: 'avatar', participant: speaker });
  });

  it('skips an active speaker whose camera is unsubscribed, falling through to a later speaker with a subscribed camera', () => {
    const local = createParticipant('local-user');
    const unwatched = createParticipant('speaker-1', { camera: publication('camera', false, false) });
    const watched = createParticipant('speaker-2', { camera: publication('camera', false, true) });
    const room = createRoom(local, [unwatched, watched]);

    const result = selectFloatTile(
      room,
      new Set(),
      [unwatched as unknown as never, watched as unknown as never],
    );

    expect(result?.kind).toBe('camera');
    expect(result?.participant).toBe(watched);
  });

  it('ignores a muted camera publication when selecting', () => {
    const local = createParticipant('local-user');
    const mutedSpeaker = createParticipant('speaker-1', { camera: publication('camera', true) });
    const room = createRoom(local, [mutedSpeaker]);

    const result = selectFloatTile(room, new Set(), [mutedSpeaker as unknown as never]);

    expect(result?.kind).toBe('avatar');
  });

  it('falls back to an avatar tile for the active speaker when nobody has video', () => {
    const local = createParticipant('local-user');
    const speaker = createParticipant('speaker-1');
    const room = createRoom(local, [speaker]);

    const result = selectFloatTile(room, new Set(), [speaker as unknown as never]);

    expect(result).toEqual({ kind: 'avatar', participant: speaker });
  });

  it('falls back to the local participant for the avatar tile when nobody is speaking', () => {
    const local = createParticipant('local-user');
    const room = createRoom(local, []);

    const result = selectFloatTile(room, new Set(), []);

    expect(result).toEqual({ kind: 'avatar', participant: local });
  });
});
