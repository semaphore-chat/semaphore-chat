import { describe, it, expect, vi, beforeEach } from 'vitest';

class FakePreset {
  width: number;
  height: number;
  encoding: { maxBitrate: number; maxFramerate?: number };
  constructor(width: number, height: number, maxBitrate: number, maxFramerate?: number) {
    this.width = width;
    this.height = height;
    this.encoding = { maxBitrate, maxFramerate };
  }
}

vi.mock('livekit-client', () => ({
  VideoPreset: FakePreset,
  Track: {
    Kind: { Video: 'video', Audio: 'audio' },
    Source: { ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio' },
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getScreenShareCaptureOptions,
  buildScreenSharePublishOptions,
  publishScreenShare,
} from '../../features/voice/screenSharePublish';
import { computeScreenShareBitrate } from '../../utils/screenShareQuality';
import type { Room } from 'livekit-client';

describe('getScreenShareCaptureOptions', () => {
  it('maps 1080p60', () => {
    expect(getScreenShareCaptureOptions({ resolution: '1080p', fps: 60 }, false)).toEqual({
      audio: false,
      resolution: { width: 1920, height: 1080, frameRate: 60 },
      video: undefined,
      contentHint: 'motion',
      preferCurrentTab: false,
    });
  });
  it('maps 4k', () => {
    const o = getScreenShareCaptureOptions({ resolution: '4k', fps: 30 }, false);
    expect(o.resolution).toMatchObject({ width: 3840, height: 2160 });
  });
  it('native passes 0x0 plus frameRate video constraints', () => {
    const o = getScreenShareCaptureOptions({ resolution: 'native', fps: 60 }, false);
    expect(o.resolution).toEqual({ width: 0, height: 0, frameRate: 60 });
    expect(o.video).toEqual({ frameRate: 60 });
  });
  it('uses detail hint at 15 fps', () => {
    expect(getScreenShareCaptureOptions({ resolution: '1080p', fps: 15 }, false).contentHint).toBe('detail');
  });
  it('passes audio objects through', () => {
    const audio = { echoCancellation: false };
    expect(getScreenShareCaptureOptions({ resolution: '1080p', fps: 30 }, audio).audio).toBe(audio);
  });
});

describe('buildScreenSharePublishOptions', () => {
  it('constructs layers with the preset ctor', () => {
    const o = buildScreenSharePublishOptions(1920, 1080, 60, FakePreset as never);
    expect(o.screenShareEncoding?.maxFramerate).toBe(60);
    expect(o.simulcast).toBe(true);
    expect(o.videoCodec).toBe('vp8');
    const layers = o.screenShareSimulcastLayers as unknown as FakePreset[];
    expect(layers).toHaveLength(2);
    expect(layers.every((l) => l instanceof FakePreset)).toBe(true);
    expect(layers[0]).toMatchObject({ width: 480, height: 270, encoding: { maxFramerate: 15 } });
    expect(layers[1]).toMatchObject({
      width: 960,
      height: 540,
      encoding: { maxFramerate: 30, maxBitrate: computeScreenShareBitrate(960, 540, 30) },
    });
  });
});

describe('publishScreenShare', () => {
  const videoTrack = () => ({
    kind: 'video',
    mediaStreamTrack: {
      getSettings: () => ({ width: 2560, height: 1440, frameRate: 60 }),
      contentHint: 'motion',
    },
    stop: vi.fn(),
  });
  const audioTrack = () => ({
    kind: 'audio',
    mediaStreamTrack: { getSettings: () => ({}), contentHint: '' },
    stop: vi.fn(),
  });

  let lp: {
    createScreenTracks: ReturnType<typeof vi.fn>;
    publishTrack: ReturnType<typeof vi.fn>;
    unpublishTrack: ReturnType<typeof vi.fn>;
  };
  let room: Room;
  const settings = { resolution: '1080p', fps: 60 };

  beforeEach(() => {
    lp = {
      createScreenTracks: vi.fn(),
      publishTrack: vi.fn().mockResolvedValue({ sid: 'pub' }),
      unpublishTrack: vi.fn().mockResolvedValue(undefined),
    };
    room = { localParticipant: lp } as unknown as Room;
  });

  it('publishes video sized from the actual track and audio with audio options', async () => {
    const v = videoTrack();
    const a = audioTrack();
    lp.createScreenTracks.mockResolvedValue([v, a]);
    lp.publishTrack.mockImplementation(async (t: { kind: string }) =>
      t.kind === 'video' ? { sid: 'video-pub' } : { sid: 'audio-pub' },
    );

    const result = await publishScreenShare(room, settings, true);

    expect(lp.createScreenTracks).toHaveBeenCalledWith(getScreenShareCaptureOptions(settings, true));
    const [vTrack, vOpts] = lp.publishTrack.mock.calls[0];
    expect(vTrack).toBe(v);
    expect(vOpts.source).toBe('screen_share');
    expect(vOpts.screenShareEncoding.maxFramerate).toBe(60);
    expect(vOpts.screenShareEncoding.maxBitrate).toBe(computeScreenShareBitrate(2560, 1440, 60));
    expect(vOpts.screenShareSimulcastLayers).toHaveLength(2);
    const [aTrack, aOpts] = lp.publishTrack.mock.calls[1];
    expect(aTrack).toBe(a);
    expect(aOpts.source).toBe('screen_share_audio');
    expect(aOpts.dtx).toBe(false);
    expect(aOpts.audioPreset.maxBitrate).toBe(128000);
    expect(result).toEqual({ sid: 'video-pub' });
  });

  it('unpublishes and stops every track when publishing fails, then rethrows', async () => {
    const v = videoTrack();
    const a = audioTrack();
    lp.createScreenTracks.mockResolvedValue([v, a]);
    const err = new Error('publish failed');
    lp.publishTrack.mockRejectedValue(err);

    await expect(publishScreenShare(room, settings, true)).rejects.toBe(err);
    expect(lp.unpublishTrack).toHaveBeenCalledWith(v);
    expect(lp.unpublishTrack).toHaveBeenCalledWith(a);
    expect(v.stop).toHaveBeenCalled();
    expect(a.stop).toHaveBeenCalled();
  });

  it('propagates capture errors without publishing', async () => {
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    lp.createScreenTracks.mockRejectedValue(err);
    await expect(publishScreenShare(room, settings, true)).rejects.toBe(err);
    expect(lp.publishTrack).not.toHaveBeenCalled();
  });
});
