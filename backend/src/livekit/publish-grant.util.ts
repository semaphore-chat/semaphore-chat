import { TrackSource } from 'livekit-server-sdk';

/** What a participant may publish in a voice room. */
export interface PublishGrant {
  canPublish: boolean;
  /**
   * When set, only these sources may be published. Undefined means every
   * source, including the soundboard track (published as Source.Unknown,
   * which LiveKit grants can't name).
   */
  canPublishSources?: TrackSource[];
}

/** Everything (DM calls, instance owners, members with all voice actions). */
export const FULL_PUBLISH_GRANT: PublishGrant = { canPublish: true };

/**
 * Maps channel voice capabilities to a LiveKit publish grant: microphone
 * needs SPEAK, camera VIDEO, screen share (+ its audio) SCREEN_SHARE. A
 * timed-out member has none of the three, so subscribe-only.
 *
 * Note `canPublishSources: []` would mean "all sources" to LiveKit, so
 * nothing-allowed is expressed as `canPublish: false`. A partial grant must
 * list sources, which blocks the soundboard (Source.Unknown) too.
 */
export function publishGrantFor(caps: {
  speak: boolean;
  video: boolean;
  share: boolean;
}): PublishGrant {
  if (caps.speak && caps.video && caps.share) return FULL_PUBLISH_GRANT;
  const sources: TrackSource[] = [];
  if (caps.speak) sources.push(TrackSource.MICROPHONE);
  if (caps.video) sources.push(TrackSource.CAMERA);
  if (caps.share) {
    sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  }
  if (sources.length === 0) return { canPublish: false };
  return { canPublish: true, canPublishSources: sources };
}
