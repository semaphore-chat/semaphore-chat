import { describe, it, expect } from 'vitest';
import {
  computeScreenShareBitrate as bitrate,
  computeScreenSharePublishOptions,
  getScreenShareContentHint,
  SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS,
} from '../../utils/screenShareQuality';

describe('computeScreenShareBitrate', () => {
  it('is monotonic in width, height and fps', () => {
    expect(bitrate(2560, 1080, 30)).toBeGreaterThan(bitrate(1280, 1080, 30));
    expect(bitrate(1920, 1440, 30)).toBeGreaterThan(bitrate(1920, 720, 30));
    expect(bitrate(1920, 1080, 60)).toBeGreaterThan(bitrate(1920, 1080, 30));
    expect(bitrate(1920, 1080, 30)).toBeGreaterThan(bitrate(1920, 1080, 15));
  });

  it('lands in the target range for common captures', () => {
    const b1080 = bitrate(1920, 1080, 60);
    expect(b1080).toBeGreaterThanOrEqual(8e6);
    expect(b1080).toBeLessThanOrEqual(10e6);
    const b1440 = bitrate(2560, 1440, 60);
    expect(b1440).toBeGreaterThanOrEqual(12e6);
    expect(b1440).toBeLessThanOrEqual(15e6);
    const b4k = bitrate(3840, 2160, 60);
    expect(b4k).toBeGreaterThanOrEqual(20e6);
    expect(b4k).toBeLessThanOrEqual(26e6);
  });

  it('1080p30 is at least double the old 2.5 Mbps default', () => {
    expect(bitrate(1920, 1080, 30)).toBeGreaterThanOrEqual(5e6);
  });

  it('has a floor and a ceiling', () => {
    expect(bitrate(2, 2, 1)).toBe(150_000);
    expect(bitrate(7680, 4320, 120)).toBe(50_000_000);
  });

  it('is a multiple of 100 kbps', () => {
    for (const [w, h, f] of [[1920, 1080, 60], [1366, 768, 30], [853, 480, 15], [2560, 1440, 60]]) {
      expect(bitrate(w, h, f) % 100_000).toBe(0);
    }
  });
});

describe('computeScreenSharePublishOptions', () => {
  it('builds 1080p60 options', () => {
    const o = computeScreenSharePublishOptions(1920, 1080, 60);
    expect(o.screenShareEncoding.maxFramerate).toBe(60);
    expect(o.screenShareEncoding.maxBitrate).toBe(bitrate(1920, 1080, 60));
    expect(o.simulcast).toBe(true);
    expect(o.videoCodec).toBe('vp8');
    expect(o.screenShareSimulcastLayers).toHaveLength(2);
    const [low, mid] = o.screenShareSimulcastLayers;
    expect(mid).toMatchObject({ width: 960, height: 540, encoding: { maxFramerate: 30 } });
    expect(low).toMatchObject({ width: 480, height: 270, encoding: { maxFramerate: 15 } });
    expect(mid.encoding.maxBitrate).toBe(bitrate(960, 540, 30));
    expect(low.encoding.maxBitrate).toBe(bitrate(480, 270, 15));
    expect(mid.encoding.maxBitrate).toBeLessThan(o.screenShareEncoding.maxBitrate);
    expect(low.encoding.maxBitrate).toBeLessThan(mid.encoding.maxBitrate);
  });

  it('builds 4K60 layers', () => {
    const [low, mid] = computeScreenSharePublishOptions(3840, 2160, 60).screenShareSimulcastLayers;
    expect(low).toMatchObject({ width: 960, height: 540, encoding: { maxFramerate: 15 } });
    expect(mid).toMatchObject({ width: 1920, height: 1080, encoding: { maxFramerate: 30 } });
  });

  it('caps layer fps at the top fps', () => {
    const o = computeScreenSharePublishOptions(1280, 720, 15);
    expect(o.screenShareEncoding.maxFramerate).toBe(15);
    for (const l of o.screenShareSimulcastLayers) expect(l.encoding.maxFramerate).toBe(15);
  });

  it('uses a single half-size lower layer for small captures', () => {
    const o = computeScreenSharePublishOptions(800, 600, 30);
    expect(o.screenShareSimulcastLayers).toHaveLength(1);
    expect(o.screenShareSimulcastLayers[0]).toMatchObject({
      width: 400,
      height: 300,
      encoding: { maxFramerate: 30 },
    });
  });

  it('keeps layer dimensions even', () => {
    const o = computeScreenSharePublishOptions(1366, 769, 60);
    for (const l of o.screenShareSimulcastLayers) {
      expect(l.width % 2).toBe(0);
      expect(l.height % 2).toBe(0);
    }
  });

  it('picks the degradation preference from fps', () => {
    expect(computeScreenSharePublishOptions(1920, 1080, 60).degradationPreference).toBe('balanced');
    expect(computeScreenSharePublishOptions(1920, 1080, 30).degradationPreference).toBe('balanced');
    expect(computeScreenSharePublishOptions(1920, 1080, 15).degradationPreference).toBe('maintain-resolution');
  });

  it('normalizes invalid fps to 30', () => {
    for (const bad of [0, NaN, undefined as unknown as number]) {
      expect(computeScreenSharePublishOptions(1920, 1080, bad).screenShareEncoding.maxFramerate).toBe(30);
    }
  });
});

describe('getScreenShareContentHint', () => {
  it('maps fps to a hint', () => {
    expect(getScreenShareContentHint(60)).toBe('motion');
    expect(getScreenShareContentHint(30)).toBe('motion');
    expect(getScreenShareContentHint(15)).toBe('detail');
  });
});

describe('SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS', () => {
  it('is high-bitrate stereo without DTX', () => {
    expect(SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS.dtx).toBe(false);
    expect(SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS.audioPreset.maxBitrate).toBe(128000);
    expect(SCREEN_SHARE_AUDIO_PUBLISH_OPTIONS.forceStereo).toBe(true);
  });
});
