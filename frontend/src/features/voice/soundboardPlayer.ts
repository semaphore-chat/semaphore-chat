import type { Room, LocalTrackPublication, Track } from 'livekit-client';
import { logger } from '../../utils/logger';
import { TRACK_SOURCE } from './livekitEvents';

/**
 * The LiveKit `Track.Source` enum is fixed and cannot be extended, so the
 * soundboard track is published as `Source.Unknown` and distinguished purely by
 * this track NAME on both the publish side and the remote subscribe/render side.
 *
 * Both `useTrackSubscription` (auto-subscribe) and `AudioRenderer` (attach to a
 * hidden <audio> element) match on this exact name — keep them in sync.
 *
 * IMPORTANT: `SOUNDBOARD_TRACK_NAME` is imported directly (statically) by both
 * of those always-mounted modules — this file is NOT only reachable via
 * voiceActions.ts's dynamic import, despite the class below (SoundboardPlayer)
 * only being *used* from there. A static import pulls in this whole module,
 * including its top-level imports — which is why `Track` is imported as a
 * TYPE only below, with the one runtime enum access (`Track.Source.Unknown`)
 * routed through the livekitEvents.ts constants instead. Do not reintroduce a
 * runtime `import { Track } from 'livekit-client'` here without re-auditing
 * every static importer of this file.
 */
export const SOUNDBOARD_TRACK_NAME = 'soundboard';

/**
 * Soundboard playback engine.
 *
 * Screen-share audio uses LiveKit's built-in capture; the soundboard has no such
 * helper, so we build a WebAudio graph by hand:
 *
 *   decoded AudioBuffer
 *     → AudioBufferSourceNode
 *       ├→ MediaStreamAudioDestinationNode → MediaStreamTrack → publishTrack()  (remote participants)
 *       └→ AudioContext.destination                                            (local monitor)
 *
 * The published track is kept alive for the whole voice session (published lazily
 * on first play) rather than published/unpublished per clip. This avoids a
 * subscribe race — republishing on every trigger would make remote clients
 * re-subscribe each time and clip the first ~200ms of audio — and makes rapid
 * re-triggering a cheap stop-and-restart of the source node. The track is torn
 * down (and the AudioContext closed) when the user leaves/disconnects.
 */
class SoundboardPlayer {
  private audioContext: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private publication: LocalTrackPublication | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private readonly bufferCache = new Map<string, AudioBuffer>();

  private ensureContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.audioContext = new Ctor();
      this.destination = this.audioContext.createMediaStreamDestination();
    }
    if (!this.destination) {
      this.destination = this.audioContext.createMediaStreamDestination();
    }
    return this.audioContext;
  }

  private async ensurePublished(room: Room): Promise<void> {
    // Re-publish if we have no publication or it belongs to a stale room.
    const stillPublished =
      this.publication &&
      room.localParticipant.trackPublications.has(this.publication.trackSid);
    if (stillPublished) return;

    this.ensureContext();
    const track = this.destination!.stream.getAudioTracks()[0];
    if (!track) {
      throw new Error('Soundboard: no audio track on destination node');
    }
    logger.info('[Soundboard] Publishing soundboard track');
    this.publication = await room.localParticipant.publishTrack(track, {
      name: SOUNDBOARD_TRACK_NAME,
      // `publishTrack`'s `source` option is typed against the nominal
      // `Track.Source` enum, not a string literal — TRACK_SOURCE.Unknown's
      // value is verified equal to it (see livekitEvents.ts), so this cast
      // is a type-system formality, not a value-correctness bypass.
      source: TRACK_SOURCE.Unknown as Track.Source,
      stopMicTrackOnMute: false,
      dtx: false,
      red: false,
    });
  }

  /**
   * Eagerly build the WebAudio graph and publish the (silent) soundboard track.
   *
   * Called when a community voice session becomes active so the remote
   * TrackPublished → subscribe → attach pipeline is already warm before the
   * first clip is triggered — publishing lazily on first play() would race
   * remote subscription (~100-500ms) and clip or swallow the first sound.
   *
   * Safe to call repeatedly; errors are logged, not thrown (play() retries
   * ensurePublished as a fallback). The AudioContext may start suspended
   * without a user gesture — that's fine: the published track just carries
   * silence until play() resumes it on click.
   */
  async warmup(room: Room): Promise<void> {
    try {
      this.ensureContext();
      await this.ensurePublished(room);
    } catch (err) {
      logger.warn('[Soundboard] Warmup failed (will retry on first play)', err);
    }
  }

  /**
   * Fetch already handled by the caller; `arrayBuffer` is the raw encoded audio.
   * Decodes (and caches by fileId) then plays the clip, publishing the track on
   * first use. Rapid re-triggers stop the currently-playing clip and start the
   * new one.
   */
  async play(room: Room, fileId: string, arrayBuffer: ArrayBuffer): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    await this.ensurePublished(room);

    let buffer = this.bufferCache.get(fileId);
    if (!buffer) {
      // decodeAudioData detaches the passed buffer, so decode a copy to keep the
      // original intact for potential retries.
      buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      this.bufferCache.set(fileId, buffer);
    }

    this.stopCurrentSource();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination!); // → remote participants
    source.connect(ctx.destination); // → local speakers (monitor)
    source.onended = () => {
      if (this.currentSource === source) {
        this.currentSource = null;
      }
    };
    this.currentSource = source;
    source.start();
    logger.info('[Soundboard] Playing sound', fileId);
  }

  private stopCurrentSource(): void {
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
      } catch {
        // already stopped
      }
      this.currentSource = null;
    }
  }

  /**
   * Stop playback, unpublish the track, and close the AudioContext. Safe to call
   * repeatedly and when nothing has been published.
   */
  async dispose(room: Room | null): Promise<void> {
    this.stopCurrentSource();

    if (this.publication && room) {
      try {
        const track = this.publication.track;
        if (track) {
          await room.localParticipant.unpublishTrack(track);
        }
      } catch (err) {
        logger.warn('[Soundboard] Failed to unpublish soundboard track', err);
      }
    }
    this.publication = null;

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch (err) {
        logger.warn('[Soundboard] Failed to close AudioContext', err);
      }
    }
    this.audioContext = null;
    this.destination = null;
    this.bufferCache.clear();
  }
}

export const soundboardPlayer = new SoundboardPlayer();
