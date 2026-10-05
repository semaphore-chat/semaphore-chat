import { TrackSource } from 'livekit-server-sdk';
import { FULL_PUBLISH_GRANT, publishGrantFor } from './publish-grant.util';

describe('publishGrantFor', () => {
  it('all voice actions: unrestricted (soundboard keeps working)', () => {
    expect(publishGrantFor({ speak: true, video: true, share: true })).toBe(
      FULL_PUBLISH_GRANT,
    );
  });

  it('timed out (no voice actions): subscribe-only, never canPublishSources: [] (which means "all")', () => {
    expect(
      publishGrantFor({ speak: false, video: false, share: false }),
    ).toEqual({
      canPublish: false,
    });
  });

  it.each<
    [string, { speak: boolean; video: boolean; share: boolean }, TrackSource[]]
  >([
    [
      'speak only',
      { speak: true, video: false, share: false },
      [TrackSource.MICROPHONE],
    ],
    [
      'video only',
      { speak: false, video: true, share: false },
      [TrackSource.CAMERA],
    ],
    [
      'share only (with its audio)',
      { speak: false, video: false, share: true },
      [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    ],
    [
      'speak + share',
      { speak: true, video: false, share: true },
      [
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ],
    ],
  ])('%s: lists exactly those sources', (_name, caps, sources) => {
    expect(publishGrantFor(caps)).toEqual({
      canPublish: true,
      canPublishSources: sources,
    });
  });
});
