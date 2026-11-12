import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { MediaDimensionsService } from './media-dimensions.service';
import {
  FfmpegProvider,
  FfprobeStreams,
} from '@/livekit/providers/ffmpeg.provider';

function probe(...streams: unknown[]): FfprobeStreams {
  return { streams } as FfprobeStreams;
}

describe('MediaDimensionsService', () => {
  let service: MediaDimensionsService;
  let ffmpegProvider: Mocked<FfmpegProvider>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      MediaDimensionsService,
    ).compile();

    service = unit;
    ffmpegProvider = unitRef.get(FfmpegProvider);
    jest.clearAllMocks();
  });

  it('reads a landscape image as it is stored', async () => {
    ffmpegProvider.probeStreams.mockResolvedValue(
      probe({ codec_type: 'video', width: 1920, height: 1080 }),
    );

    await expect(
      service.read('/uploads/photo.jpg', 'image/jpeg'),
    ).resolves.toEqual({ width: 1920, height: 1080 });
    expect(ffmpegProvider.probeStreams).toHaveBeenCalledWith(
      '/uploads/photo.jpg',
      expect.any(Number),
    );
  });

  it('reads a portrait image as it is stored', async () => {
    ffmpegProvider.probeStreams.mockResolvedValue(
      probe({ codec_type: 'video', width: 1080, height: 1920 }),
    );

    await expect(
      service.read('/uploads/photo.jpg', 'image/jpeg'),
    ).resolves.toEqual({ width: 1080, height: 1920 });
  });

  it('swaps width and height for a video rotated 90 degrees by its rotate tag', async () => {
    ffmpegProvider.probeStreams.mockResolvedValue(
      probe({
        codec_type: 'video',
        width: 1920,
        height: 1080,
        tags: { rotate: '90' },
      }),
    );

    await expect(
      service.read('/uploads/clip.mp4', 'video/mp4'),
    ).resolves.toEqual({ width: 1080, height: 1920 });
  });

  it('swaps width and height for a video whose side data says 270', async () => {
    ffmpegProvider.probeStreams.mockResolvedValue(
      probe({
        codec_type: 'video',
        width: 1920,
        height: 1080,
        side_data_list: [{ rotation: -90 }],
      }),
    );

    await expect(
      service.read('/uploads/clip.mp4', 'video/mp4'),
    ).resolves.toEqual({ width: 1080, height: 1920 });
  });

  it('keeps the stored orientation for a 180 degree rotation', async () => {
    ffmpegProvider.probeStreams.mockResolvedValue(
      probe({
        codec_type: 'video',
        width: 1920,
        height: 1080,
        side_data_list: [{ rotation: 180 }],
      }),
    );

    await expect(
      service.read('/uploads/clip.mp4', 'video/mp4'),
    ).resolves.toEqual({ width: 1920, height: 1080 });
  });

  it('picks the video stream when an audio stream comes first', async () => {
    ffmpegProvider.probeStreams.mockResolvedValue(
      probe(
        { codec_type: 'audio', sample_rate: '48000' },
        { codec_type: 'video', width: 640, height: 480 },
      ),
    );

    await expect(
      service.read('/uploads/clip.mp4', 'video/mp4'),
    ).resolves.toEqual({ width: 640, height: 480 });
  });

  it('does not probe a non-media file', async () => {
    await expect(
      service.read('/uploads/document.pdf', 'application/pdf'),
    ).resolves.toBeNull();
    expect(ffmpegProvider.probeStreams).not.toHaveBeenCalled();
  });

  it('does not probe an SVG, which has no fixed pixel size', async () => {
    await expect(
      service.read('/uploads/logo.svg', 'image/svg+xml'),
    ).resolves.toBeNull();
    expect(ffmpegProvider.probeStreams).not.toHaveBeenCalled();
  });

  it('returns null when the probe fails', async () => {
    ffmpegProvider.probeStreams.mockRejectedValue(
      new Error('Invalid data found'),
    );

    await expect(
      service.read('/uploads/broken.jpg', 'image/jpeg'),
    ).resolves.toBeNull();
  });

  it('returns null when the probe times out', async () => {
    ffmpegProvider.probeStreams.mockRejectedValue(
      new Error('ffprobe timed out after 5 ms'),
    );

    await expect(
      service.read('/uploads/slow.mp4', 'video/mp4', 5),
    ).resolves.toBeNull();
    // The limit reaches the provider, which kills ffprobe with it.
    expect(ffmpegProvider.probeStreams).toHaveBeenCalledWith(
      '/uploads/slow.mp4',
      5,
    );
  });

  it('returns null when the probe reports no dimensions', async () => {
    ffmpegProvider.probeStreams.mockResolvedValue(
      probe({ codec_type: 'video' }),
    );

    await expect(
      service.read('/uploads/broken.jpg', 'image/jpeg'),
    ).resolves.toBeNull();
  });
});
