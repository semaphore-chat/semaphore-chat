import { TrackSource } from 'livekit-server-sdk';

/** What a participant may publish in a voice room. */
export interface PublishGrant {
  canPublish: boolean;
  /**
   * When set, only these sources may be published. Undefined means every
   * source, including the soundboard track (published as Source.Unknown).
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
 * The soundboard publishes a separate track with source Unknown, so a grant
 * that lists sources must include UNKNOWN for it to be accepted — but only
 * for someone who may speak: a server-muted or timed-out member must not get
 * it (#659). A JWT grant can't spell UNKNOWN out (the server SDK throws when
 * converting it), so generateToken drops it; the participant_joined webhook
 * applies this grant through the admin API, which can carry it.
 *
 * Note `canPublishSources: []` would mean "all sources" to LiveKit, so
 * nothing-allowed is expressed as `canPublish: false`.
 */
export function publishGrantFor(
  caps: {
    speak: boolean;
    video: boolean;
    share: boolean;
  },
  /** A moderator's server mute takes the microphone until it's lifted. */
  serverMuted = false,
): PublishGrant {
  const speak = caps.speak && !serverMuted;
  if (speak && caps.video && caps.share) return FULL_PUBLISH_GRANT;
  const sources: TrackSource[] = [];
  if (speak) sources.push(TrackSource.MICROPHONE, TrackSource.UNKNOWN);
  if (caps.video) sources.push(TrackSource.CAMERA);
  if (caps.share) {
    sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  }
  if (sources.length === 0) return { canPublish: false };
  return { canPublish: true, canPublishSources: sources };
}
