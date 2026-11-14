import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { MediaDimensionsService } from './media-dimensions.service';
import {
  FfmpegProvider,
  FfprobeStreams,
} from '@/livekit/providers/ffmpeg.provider';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

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

  describe('decode limits', () => {
    let dir: string;

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'media-dimensions-'));
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    /** A PNG signature and IHDR declaring the given size. */
    const pngHeader = (width: number, height: number) => {
      const header = Buffer.alloc(33);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
        header,
      );
      header.writeUInt32BE(13, 8);
      header.write('IHDR', 12, 'latin1');
      header.writeUInt32BE(width, 16);
      header.writeUInt32BE(height, 20);
      header[24] = 16;
      header[25] = 6;
      return header;
    };

    it('never runs ffprobe on an image whose header is over the pixel cap', async () => {
      const bomb = join(dir, 'bomb.png');
      await writeFile(bomb, pngHeader(20000, 20000));

      await expect(service.read(bomb, 'image/png')).resolves.toBeNull();
      expect(ffmpegProvider.probeStreams).not.toHaveBeenCalled();
    });

    it('still probes an image within the cap (ffprobe applies EXIF rotation)', async () => {
      const photo = join(dir, 'photo.png');
      await writeFile(photo, pngHeader(4000, 3000));
      ffmpegProvider.probeStreams.mockResolvedValue(
        probe({ codec_type: 'video', width: 4000, height: 3000 }),
      );

      await expect(service.read(photo, 'image/png')).resolves.toEqual({
        width: 4000,
        height: 3000,
      });
    });

    it('runs one probe at a time', async () => {
      let release: () => void = () => undefined;
      ffmpegProvider.probeStreams
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () =>
                resolve(probe({ codec_type: 'video', width: 1, height: 1 }));
            }),
        )
        .mockResolvedValueOnce(
          probe({ codec_type: 'video', width: 2, height: 2 }),
        );

      const first = service.read('/uploads/a.mp4', 'video/mp4');
      const second = service.read('/uploads/b.mp4', 'video/mp4');
      await new Promise((resolve) => setImmediate(resolve));

      expect(ffmpegProvider.probeStreams).toHaveBeenCalledTimes(1);

      release();
      await expect(first).resolves.toEqual({ width: 1, height: 1 });
      await expect(second).resolves.toEqual({ width: 2, height: 2 });
    });
  });
});
