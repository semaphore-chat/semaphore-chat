/**
 * Screen share capture and publish quality.
 *
 * Why this exists: livekit-client's `publishDefaults.screenShareEncoding` is
 * `ScreenSharePresets.h1080fps15` (2.5 Mbps, 15 fps). Every screen share that
 * doesn't pass its own encoding gets that, whatever resolution and frame rate
 * the user picked, so "1080p60" (or 4K60) went out at 15 fps and 2.5 Mbps.
 * Here the encoding follows the capture: the top simulcast layer carries the
 * chosen frame rate and a bitrate sized for resolution x fps.
 *
 * Only the top layer is uncapped. Lower simulcast layers stay cheap so that
 * viewers on weak connections (and small tiles, via adaptiveStream) get a
 * lower layer instead of stalling: the SFU forwards, it doesn't transcode.
 *
 * Codec: VP8 with rid simulcast (LiveKit's default codec). livekit-client
 * 2.22.3 publishes VP9/AV1 screen shares as a single spatial layer (L1T3)
 * unless rid "SVC simulcast" is possible, which Safari can't do, and its
 * screen-share backup codec is single-layer too. That would leave weak
 * viewers without a lower layer, so VP8 is the robust default; see the docs
 * (docs-site/docs/architecture/voice-video-quality.md) for the trade-off.
 *
 * Pure functions, no livekit-client runtime import: the livekit chunk stays
 * lazy (bundle budget). Presets are plain `{ width, height, encoding }`
 * objects, the shape livekit-client reads from `VideoPreset`.
 */

export interface ScreenShareQualitySettings {
  resolution: string;
  fps: number;
}

export interface ScreenShareEncodingSpec {
  maxBitrate: number;
  maxFramerate: number;
  priority?: 'very-low' | 'low' | 'medium' | 'high';
}

export interface ScreenSharePresetSpec {
  width: number;
  height: number;
  encoding: ScreenShareEncodingSpec;
}

export interface ScreenSharePublishSpec {
  /** Top layer: the user's resolution and frame rate, generous bitrate. */
  screenShareEncoding: ScreenShareEncodingSpec;
  /** Lower simulcast layers, low to high. */
  screenShareSimulcastLayers: ScreenSharePresetSpec[];
  simulcast: true;
  videoCodec: 'vp8';
  degradationPreference: RTCDegradationPreference;
}

/** Frame rates the app accepts for screen capture. */
export const SCREEN_SHARE_FPS_OPTIONS = [15, 30, 60] as const;

const DEFAULT_FPS = 30;
/** Floor for any layer: below this VP8 falls apart at any resolution. */
const MIN_LAYER_BITRATE = 150_000;
/** Ceiling for the top layer (an 8K60 "native" capture would compute more). */
const MAX_TOP_BITRATE = 50_000_000;

/**
 * Bitrate for a VP8 stream of `width` x `height` at `fps`.
 *
 * bitrate = 7.65 * (pixels per second)^0.75, rounded to 100 kbps.
 *
 * Bits needed grow sublinearly with pixel rate (more pixels and more frames
 * mean more redundancy between neighbours and frames), and the 0.75 power
 * with this constant lands on generous, Nitro-beating targets:
 *   1080p30 ~5.4 Mbps (LiveKit's own h1080fps30 is 5 Mbps)
 *   1080p60 ~9 Mbps     1440p60 ~13.9 Mbps     4K60 ~25.5 Mbps
 *   720p30 ~2.9 Mbps    540p15 ~1.1 Mbps
 * These are ceilings (maxBitrate); the encoder uses less on static content
 * and the congestion controller lowers them on a weak uplink.
 */
export function computeScreenShareBitrate(width: number, height: number, fps: number): number {
  const pixelsPerSecond = Math.max(1, width) * Math.max(1, height) * Math.max(1, fps);
  const raw = 7.65 * Math.pow(pixelsPerSecond, 0.75);
  const rounded = Math.round(raw / 100_000) * 100_000;
  return Math.min(MAX_TOP_BITRATE, Math.max(MIN_LAYER_BITRATE, rounded));
}

/** Normalises a stored/picked fps to a positive integer (default 30). */
export function normalizeScreenShareFps(fps: unknown): number {
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? Math.round(fps) : DEFAULT_FPS;
}

function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

/**
 * Publish options for a captured screen share of `width` x `height`, captured
 * at the user's chosen `fps`.
 *
 * Layers (rid q / h / f, what livekit-client builds from these):
 *   f: full capture size, chosen fps, computeScreenShareBitrate()
 *   h: half size, min(fps, 30)
 *   q: quarter size, min(fps, 15)
 * e.g. 4K60 -> 2160p60 / 1080p30 / 540p15, 1080p60 -> 1080p60 / 540p30 / 270p15.
 * Below 960 px on the long side livekit-client uses two layers; we then give
 * it only the half-size one so the second layer is useful, not 1/4 size.
 *
 * Upload cost is the sum of the layers (4K60 ~ 25.5 + 5.4 + 1.1 Mbps), but
 * with dynacast on the publisher only encodes layers someone is watching.
 */
export function computeScreenSharePublishOptions(
  width: number,
  height: number,
  fps: number,
): ScreenSharePublishSpec {
  const topFps = normalizeScreenShareFps(fps);
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));

  const layer = (divisor: number, layerFps: number): ScreenSharePresetSpec => {
    const lw = even(w / divisor);
    const lh = even(h / divisor);
    return {
      width: lw,
      height: lh,
      encoding: {
        maxBitrate: computeScreenShareBitrate(lw, lh, layerFps),
        maxFramerate: layerFps,
      },
    };
  };

  const mid = layer(2, Math.min(topFps, 30));
  const low = layer(4, Math.min(topFps, 15));
  const longSide = Math.max(w, h);

  return {
    screenShareEncoding: {
      maxBitrate: computeScreenShareBitrate(w, h, topFps),
      maxFramerate: topFps,
      // Screen share wins over camera video when the uplink is congested.
      priority: 'high',
    },
    screenShareSimulcastLayers: longSide >= 960 ? [low, mid] : [mid],
    simulcast: true,
    videoCodec: 'vp8',
    degradationPreference: getScreenShareDegradationPreference(topFps),
  };
}

/**
 * Content hint for the capture track.
 *
 * 30 fps and up is a request for smooth motion (games, video): 'motion' also
 * keeps Chromium off its screencast encoder path, which favours sharpness over
 * frame rate and limits screen-content simulcast. 15 fps is a request for
 * sharp, mostly static content (code, documents): 'detail'.
 */
export function getScreenShareContentHint(fps: number): 'motion' | 'detail' {
  return normalizeScreenShareFps(fps) >= 30 ? 'motion' : 'detail';
}

/**
 * What the encoder gives up first when CPU or bandwidth runs short: motion
 * shares keep a balance of fps and resolution; detail shares keep resolution
 * (text must stay readable).
 */
export function getScreenShareDegradationPreference(fps: number): RTCDegradationPreference {
  return getScreenShareContentHint(fps) === 'motion' ? 'balanced' : 'maintain-resolution';
}

/**
 * Publish options for the screen-share audio track (tab/system audio): music,
 * not speech, so stereo at a high bitrate, no DTX (it would gate quiet passages).
 */
export const SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS = {
  audioPreset: { maxBitrate: 128_000 },
  dtx: false,
  red: true,
  forceStereo: true,
} as const;
