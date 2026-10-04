import { describe, it, expect, vi } from 'vitest';
import { RemoteVideoTrack, type Track } from 'livekit-client';
import {
  setScreenShareFocused,
  FOCUSED_SCREEN_SHARE_PIXEL_DENSITY,
} from '../../utils/screenShareViewQuality';

function fakeTrack(extra: Record<string, unknown> = {}) {
  return {
    isAdaptiveStream: true,
    adaptiveStreamSettings: {} as Record<string, unknown>,
    updateDimensions: vi.fn(),
    ...extra,
  };
}
const asTrack = (t: unknown) => t as Track;

describe('setScreenShareFocused', () => {
  it('sets then removes the pixel density and recomputes each time', () => {
    const t = fakeTrack();
    setScreenShareFocused(asTrack(t), true);
    expect(FOCUSED_SCREEN_SHARE_PIXEL_DENSITY).toBe(4);
    expect(t.adaptiveStreamSettings.pixelDensity).toBe(4);
    expect(t.updateDimensions).toHaveBeenCalledTimes(1);

    setScreenShareFocused(asTrack(t), false);
    expect(t.adaptiveStreamSettings.pixelDensity).toBeUndefined();
    expect('pixelDensity' in t.adaptiveStreamSettings).toBe(false);
    expect(t.updateDimensions).toHaveBeenCalledTimes(2);
  });

  it('preserves other adaptive stream settings', () => {
    const t = fakeTrack({ adaptiveStreamSettings: { pauseVideoInBackground: false } });
    setScreenShareFocused(asTrack(t), true);
    expect(t.adaptiveStreamSettings).toEqual({ pauseVideoInBackground: false, pixelDensity: 4 });
    setScreenShareFocused(asTrack(t), false);
    expect(t.adaptiveStreamSettings).toEqual({ pauseVideoInBackground: false });
  });

  it('is a no-op for undefined, non-adaptive and settings-less tracks', () => {
    expect(() => setScreenShareFocused(undefined, true)).not.toThrow();
    const local = fakeTrack({ isAdaptiveStream: false });
    setScreenShareFocused(asTrack(local), true);
    expect(local.updateDimensions).not.toHaveBeenCalled();
    expect(local.adaptiveStreamSettings).toEqual({});
    const noSettings = fakeTrack({ adaptiveStreamSettings: undefined });
    expect(() => setScreenShareFocused(asTrack(noSettings), true)).not.toThrow();
    expect(noSettings.updateDimensions).not.toHaveBeenCalled();
  });
});

describe('livekit-client RemoteVideoTrack shape (pinned for 2.22.3)', () => {
  it('exposes the private fields this module relies on', () => {
    const mediaStreamTrack = {
      kind: 'video',
      id: 'track-1',
      enabled: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSettings: () => ({}),
    } as unknown as MediaStreamTrack;
    const track = new RemoteVideoTrack(
      mediaStreamTrack,
      'sid',
      undefined as unknown as RTCRtpReceiver,
      { pixelDensity: 1 } as never,
    );
    expect(track.isAdaptiveStream).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(track, 'adaptiveStreamSettings')).toBe(true);
    const internals = track as unknown as {
      updateDimensions: () => void;
      getPixelDensity: () => number;
    };
    expect(typeof internals.updateDimensions).toBe('function');
    // updateDimensions touches DOM/observers we don't have here; stub it.
    internals.updateDimensions = vi.fn();
    setScreenShareFocused(track, true);
    expect(internals.getPixelDensity()).toBe(4);
    expect(internals.updateDimensions).toHaveBeenCalled();
  });
});
