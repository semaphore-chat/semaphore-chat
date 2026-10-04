/**
 * Microphone publish quality.
 *
 * LiveKit's default mic preset is `AudioPresets.music` (48 kbps Opus). That is
 * fine for speech, but well below what Opus can deliver, and the point of a
 * self-hosted server is that nobody is paying per kilobit. The user picks one
 * of these in Settings → Voice & Video; the choice becomes the Room's audio
 * `publishDefaults`, so it covers every mic publish path (join, unmute, push
 * to talk) and applies from the next voice join.
 *
 * Pure data, no livekit-client runtime import (the livekit chunk stays lazy).
 */

export type MicQuality = 'standard' | 'high' | 'music';

export interface MicQualityOption {
  label: string;
  description: string;
  /** Opus target bitrate in bits per second. */
  maxBitrate: number;
  /**
   * Discontinuous transmission: stop sending during silence. Right for speech
   * (saves bandwidth, nobody hears the difference); off for music, where DTX
   * gates quiet passages and decaying notes.
   */
  dtx: boolean;
  /** Redundant audio packets: hides packet loss at roughly 2x the bandwidth. */
  red: boolean;
}

export const MIC_QUALITY_OPTIONS: Record<MicQuality, MicQualityOption> = {
  standard: {
    label: 'Standard (48 kbps)',
    description: 'Clear speech with the least bandwidth.',
    maxBitrate: 48_000,
    dtx: true,
    red: true,
  },
  high: {
    label: 'High (96 kbps)',
    description: 'Transparent voice. Recommended.',
    maxBitrate: 96_000,
    dtx: true,
    red: true,
  },
  music: {
    label: 'Music (128 kbps)',
    description: 'For instruments and music: highest bitrate, never gates silence.',
    maxBitrate: 128_000,
    dtx: false,
    red: true,
  },
};

export const MIC_QUALITY_ORDER: MicQuality[] = ['standard', 'high', 'music'];

export const DEFAULT_MIC_QUALITY: MicQuality = 'high';

export function isMicQuality(value: unknown): value is MicQuality {
  return typeof value === 'string' && value in MIC_QUALITY_OPTIONS;
}

/** The audio part of the Room's `publishDefaults` for a mic quality setting. */
export function getMicPublishDefaults(quality: unknown): {
  audioPreset: { maxBitrate: number };
  dtx: boolean;
  red: boolean;
} {
  const option = MIC_QUALITY_OPTIONS[isMicQuality(quality) ? quality : DEFAULT_MIC_QUALITY];
  return {
    audioPreset: { maxBitrate: option.maxBitrate },
    dtx: option.dtx,
    red: option.red,
  };
}
