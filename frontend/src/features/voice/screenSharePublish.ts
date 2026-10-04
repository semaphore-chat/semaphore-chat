/**
 * Captures and publishes a screen share with an encoding that matches the
 * capture (see utils/screenShareQuality.ts for why and how it's sized).
 *
 * `setScreenShareEnabled(true, …)` can't do this: it computes the encoding
 * before the capture exists, so it can't know the size of a "native" capture
 * or of a window smaller than the preset, and without an explicit
 * `screenShareEncoding` it falls back to LiveKit's 1080p15 default. So this
 * captures first (createScreenTracks), reads the real track size, then
 * publishes. `setScreenShareEnabled(false)` still stops it: it unpublishes by
 * source (ScreenShare + ScreenShareAudio), as does the browser's own "Stop
 * sharing" button (track ended).
 *
 * livekit-client is only imported dynamically (it's already loaded by the
 * time anyone can share a screen), keeping it out of the main bundle.
 */
import type {
  Room,
  LocalTrack,
  LocalTrackPublication,
  ScreenShareCaptureOptions,
  TrackPublishOptions,
  AudioCaptureOptions,
} from 'livekit-client';
import {
  computeScreenSharePublishOptions,
  getScreenShareContentHint,
  normalizeScreenShareFps,
  SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS,
  type ScreenShareQualitySettings,
} from '../../utils/screenShareQuality';
import { getResolutionConfig } from '../../utils/screenShareResolution';
import { logger } from '../../utils/logger';

/**
 * getDisplayMedia options for the user's resolution/fps choice.
 *
 * A preset resolution becomes ideal width/height (livekit-client's mapping;
 * the browser never upscales a smaller source). "native" passes 0x0, which
 * livekit-client treats as "don't constrain the size" (leaving `resolution`
 * undefined would make it cap the capture at 1080p30), with the frame rate
 * on the video constraints instead. The frame rate always goes in: Chromium
 * captures a display at 30 fps when none is asked for.
 */
export function getScreenShareCaptureOptions(
  settings: ScreenShareQualitySettings,
  audio: AudioCaptureOptions | boolean,
): ScreenShareCaptureOptions {
  const fps = normalizeScreenShareFps(settings.fps);
  const res = getResolutionConfig(settings.resolution, fps);
  const hasSize = !!res.width && !!res.height;
  return {
    audio,
    resolution: {
      width: hasSize ? res.width! : 0,
      height: hasSize ? res.height! : 0,
      frameRate: fps,
    },
    // livekit-client types `video` as display-surface hints only, but passes
    // it to getDisplayMedia as the video constraints.
    video: hasSize ? undefined : ({ frameRate: fps } as ScreenShareCaptureOptions['video']),
    contentHint: getScreenShareContentHint(fps),
    preferCurrentTab: false,
  };
}

/**
 * Publish options for a captured screen-share video track of the given size.
 * VideoPreset is passed in so this stays testable without livekit-client.
 */
export function buildScreenSharePublishOptions(
  width: number,
  height: number,
  fps: number,
  VideoPresetCtor: new (
    width: number,
    height: number,
    maxBitrate: number,
    maxFramerate?: number,
  ) => NonNullable<TrackPublishOptions['screenShareSimulcastLayers']>[number],
): TrackPublishOptions {
  const spec = computeScreenSharePublishOptions(width, height, fps);
  return {
    simulcast: spec.simulcast,
    videoCodec: spec.videoCodec,
    screenShareEncoding: spec.screenShareEncoding,
    screenShareSimulcastLayers: spec.screenShareSimulcastLayers.map(
      (l) => new VideoPresetCtor(l.width, l.height, l.encoding.maxBitrate, l.encoding.maxFramerate),
    ),
    degradationPreference: spec.degradationPreference,
  };
}

/**
 * Capture the screen with the user's settings and publish it (plus tab/system
 * audio when captured). Throws what getDisplayMedia throws (cancelled picker,
 * NotReadableError for audio, …); on a publish failure the captured tracks
 * are stopped first.
 */
export async function publishScreenShare(
  room: Room,
  settings: ScreenShareQualitySettings,
  audio: AudioCaptureOptions | boolean,
): Promise<LocalTrackPublication | undefined> {
  const { VideoPreset, Track } = await import('livekit-client');
  const fps = normalizeScreenShareFps(settings.fps);
  const captureOptions = getScreenShareCaptureOptions(settings, audio);
  const tracks: LocalTrack[] = await room.localParticipant.createScreenTracks(captureOptions);

  try {
    let videoPublication: LocalTrackPublication | undefined;
    for (const track of tracks) {
      if (track.kind === Track.Kind.Video) {
        const trackSettings = track.mediaStreamTrack.getSettings();
        const width = trackSettings.width ?? captureOptions.resolution?.width ?? 1920;
        const height = trackSettings.height ?? captureOptions.resolution?.height ?? 1080;
        const options = {
          ...buildScreenSharePublishOptions(width, height, fps, VideoPreset),
          source: Track.Source.ScreenShare,
        };
        logger.info('[Voice] Publishing screen share:', JSON.stringify({
          captured: { width, height, frameRate: trackSettings.frameRate },
          contentHint: track.mediaStreamTrack.contentHint,
          encoding: options.screenShareEncoding,
          layers: options.screenShareSimulcastLayers?.map((l) => ({
            width: l.width, height: l.height, ...l.encoding,
          })),
        }));
        videoPublication = await room.localParticipant.publishTrack(track, options);
      } else {
        await room.localParticipant.publishTrack(track, {
          ...SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS,
          source: Track.Source.ScreenShareAudio,
        });
      }
    }
    return videoPublication;
  } catch (error) {
    for (const track of tracks) {
      await room.localParticipant.unpublishTrack(track).catch(() => undefined);
      track.stop();
    }
    throw error;
  }
}
