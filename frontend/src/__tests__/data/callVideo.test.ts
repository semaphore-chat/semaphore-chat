import { describe, expect, it } from 'vitest';
import type { RemoteParticipant } from 'livekit-client';
import { callVideoTiles } from '../../data/callVideo';

const track = { attach: (e: HTMLMediaElement) => e, detach: (e: HTMLMediaElement) => e };

function participant(identity: string, name: string, pubs: { source: string; isMuted?: boolean; isSubscribed?: boolean; track?: unknown }[]) {
  return {
    identity,
    name,
    trackPublications: new Map(pubs.map((p, i) => [`${identity}-${i}`, { isMuted: false, isSubscribed: false, track: undefined, ...p }])),
  } as unknown as RemoteParticipant;
}

const none = { cameras: new Set<string>(), screens: new Set<string>() };

describe('callVideoTiles', () => {
  it('shares first, then cameras; mic-only participants give no tile', () => {
    const tiles = callVideoTiles(
      [
        participant('a', 'aiko', [{ source: 'camera' }, { source: 'microphone' }]),
        participant('b', 'bo', [{ source: 'microphone' }]),
        participant('c', 'cat', [{ source: 'screen_share' }, { source: 'screen_share_audio' }]),
      ],
      none,
      () => false,
    );
    expect(tiles.map((t) => t.id)).toEqual(['c:screen', 'a:camera']);
  });

  it('a camera turned off is not offered; a muted share is offered without a picture', () => {
    const tiles = callVideoTiles(
      [participant('a', 'aiko', [{ source: 'camera', isMuted: true }, { source: 'screen_share', isMuted: true, isSubscribed: true, track }])],
      none,
      () => false,
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ kind: 'screen', track: null });
  });

  it('the track only once subscribed; watched from the classic watch state; speaking; name falls back to identity', () => {
    const tiles = callVideoTiles(
      [participant('a', '', [{ source: 'screen_share', isSubscribed: true, track }]), participant('b', 'bo', [{ source: 'camera' }])],
      { cameras: new Set(['b']), screens: new Set() },
      (id) => id === 'a',
    );
    expect(tiles[0]).toMatchObject({ name: 'a', watched: false, track, speaking: true });
    expect(tiles[1]).toMatchObject({ name: 'bo', watched: true, track: null, speaking: false });
  });
});
