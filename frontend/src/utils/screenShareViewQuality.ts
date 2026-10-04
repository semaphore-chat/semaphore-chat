/**
 * Receiver side of screen-share quality.
 *
 * The Room runs with adaptiveStream (voiceActions.getRoomOptions): each remote
 * video asks the SFU for the smallest simulcast layer that covers the element
 * it's rendered in (times a pixel density), and pauses when not visible. Good
 * for tiles. But a 4K60 share viewed full screen on a 1080p display asks for
 * 1920x1080, which the 1080p30 middle layer covers, so the viewer would get
 * 30 fps instead of the 60 the sharer chose. And livekit-client lets the
 * adaptive size override an explicit setVideoQuality/setVideoDimensions
 * (RemoteTrackPublication.emitTrackUpdate keeps the smaller of the two).
 *
 * So a focused share raises its track's adaptive-stream pixel density:
 * element size x 4 covers the top layer of any share on any non-tiny focused
 * view (a 960 px wide view asks for 3840 px), while the SFU still drops to a
 * lower layer when the viewer's downlink can't carry the top one. Unfocused,
 * the density goes back to livekit's default.
 *
 * livekit-client 2.22.3 keeps the per-track settings in the (TS-private)
 * `adaptiveStreamSettings` field of RemoteVideoTrack and recomputes in the
 * (TS-private) `updateDimensions()`; this module is the only place that
 * touches them. The unit test pins that shape.
 */
import type { Track } from 'livekit-client';

export const FOCUSED_SCREEN_SHARE_PIXEL_DENSITY = 4;

interface AdaptiveTrackInternals {
  isAdaptiveStream?: boolean;
  adaptiveStreamSettings?: { pixelDensity?: number | 'screen'; [key: string]: unknown };
  updateDimensions?: () => void;
}

/** Ask for the top layer of a remote screen share (focused) or let adaptiveStream size it again. */
export function setScreenShareFocused(track: Track | undefined, focused: boolean): void {
  const internals = track as unknown as AdaptiveTrackInternals | undefined;
  if (!internals?.isAdaptiveStream || !internals.adaptiveStreamSettings) return;

  const { pixelDensity: _previous, ...rest } = internals.adaptiveStreamSettings;
  internals.adaptiveStreamSettings = focused
    ? { ...rest, pixelDensity: FOCUSED_SCREEN_SHARE_PIXEL_DENSITY }
    : rest;
  if (typeof internals.updateDimensions === 'function') {
    internals.updateDimensions();
  }
}
