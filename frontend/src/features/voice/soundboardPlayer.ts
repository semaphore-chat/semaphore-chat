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

/** How long play() waits for the soundboard track to be published before it drops the clip. */
export const PLAY_PUBLISH_WAIT_MS = 2_000;

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
  /**
   * The publish that is running, and the room it is for. A second caller (a
   * warm-up under StrictMode, a warm-up racing the first play) awaits it
   * instead of publishing the track again (#803).
   */
  private pending: { room: Room; promise: Promise<void> } | null = null;
  /** Bumped by dispose(): a publish that finishes after a leave is undone, not kept. */
  private generation = 0;

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

  /**
   * This room's soundboard publication, if the local participant has one. Found
   * by the track's name, not only by the stored sid: a full reconnect
   * republishes the local tracks under new sids, and that publication must be
   * reused rather than published a second time. Local publications only.
   */
  private findPublication(room: Room): LocalTrackPublication | null {
    const publications = room.localParticipant.trackPublications;
    if (this.publication && publications.has(this.publication.trackSid)) {
      return this.publication;
    }
    for (const publication of publications.values()) {
      if (publication.trackName === SOUNDBOARD_TRACK_NAME) return publication;
    }
    return null;
  }

  private async ensurePublished(room: Room): Promise<void> {
    if (this.adopt(room)) return;
    // One publish at a time per room: a second caller waits for the first (#803).
    const running = this.pending;
    if (running && running.room === room) {
      try {
        await running.promise;
        return;
      } catch {
        // The publish this caller waited for failed: one that started before this caller asked
        // (a warm-up refused mid-flight by a moderator mute, which LiveKit only reports by timing
        // out). This caller asked now, with the grant it has now: publish again below.
      }
      if (this.adopt(room)) return;
      if (this.pending && this.pending.room === room) return this.pending.promise;
    }
    return this.startPublish(room);
  }

  /** Reuses this room's soundboard publication, if there is one. */
  private adopt(room: Room): boolean {
    const existing = this.findPublication(room);
    if (existing) this.publication = existing;
    return existing !== null;
  }

  private startPublish(room: Room): Promise<void> {
    const promise = this.publish(room).finally(() => {
      if (this.pending?.promise === promise) this.pending = null;
    });
    this.pending = { room, promise };
    return promise;
  }

  private async publish(room: Room): Promise<void> {
    const generation = this.generation;
    const ctx = this.ensureContext();
    if (this.destination!.stream.getAudioTracks()[0]?.readyState === 'ended') {
      // LiveKit stops a local track it unpublishes (stopLocalTrackOnUnpublish), e.g. when a server mute
      // takes the grant away. That track carries nothing any more: publish a new destination's track.
      logger.info('[Soundboard] The soundboard track had ended; publishing a new one');
      this.destination = ctx.createMediaStreamDestination();
    }
    const track = this.destination!.stream.getAudioTracks()[0];
    if (!track) {
      throw new Error('Soundboard: no audio track on destination node');
    }
    logger.info('[Soundboard] Publishing soundboard track');
    const publication = await room.localParticipant.publishTrack(track, {
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
    if (generation !== this.generation) {
      // The user left (dispose ran) while this publish was in flight: take the
      // late track down again instead of keeping it for a session that ended.
      logger.info('[Soundboard] Publish finished after the session ended; unpublishing it');
      try {
        if (publication.track) await room.localParticipant.unpublishTrack(publication.track);
      } catch (err) {
        logger.warn('[Soundboard] Failed to unpublish a late soundboard track', err);
      }
      return;
    }
    this.publication = publication;
  }

  /**
   * Eagerly build the WebAudio graph and publish the (silent) soundboard track.
   *
   * Called by useSoundboardWarmup (VoiceSessionEffects, the one caller) once a
   * community call is connected and the grant allows it, so the remote
   * TrackPublished → subscribe → attach pipeline is already warm before the
   * first clip is triggered — publishing lazily on first play() would race
   * remote subscription (~100-500ms) and clip or swallow the first sound.
   *
   * Safe to call repeatedly and concurrently (one publish per room; a running
   * one is awaited); errors are logged, not thrown (play() retries
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
    // Bounded: a publish refused by the server mid-flight (a moderator mute) is reported by LiveKit
    // only when it gives up, 10-20 s later. A clip that plays that late is worse than none, so past
    // PLAY_PUBLISH_WAIT_MS the clip is dropped (not played locally either: the user must not hear a
    // clip the room did not get) and the error goes to the caller.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.ensurePublished(room),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Soundboard track is not published yet; the clip was dropped')),
            PLAY_PUBLISH_WAIT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }

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
    this.generation += 1;
    this.pending = null;
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
