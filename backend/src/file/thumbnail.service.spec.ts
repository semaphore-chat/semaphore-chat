import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ThumbnailService } from './thumbnail.service';
import { StorageService, StorageType } from '@/storage/storage.service';
import {
  FfmpegProvider,
  FfmpegCommand,
} from '@/livekit/providers/ffmpeg.provider';
import type { IStorageProvider } from '@/storage/interfaces/storage-provider.interface';

describe('ThumbnailService', () => {
  let service: ThumbnailService;
  let storageService: Mocked<StorageService>;
  let mockCommand: FfmpegCommand & { run: jest.Mock; kill: jest.Mock };
  let eventCallbacks: Record<string, (...args: unknown[]) => void>;
  let allCallbacks: Record<string, Array<(...args: unknown[]) => void>>;

  const mockFfmpegProvider = {
    createCommand: jest.fn(),
    ffprobe: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    eventCallbacks = {};
    allCallbacks = {};

    mockCommand = {
      input: jest.fn().mockReturnThis(),
      inputOptions: jest.fn().mockReturnThis(),
      outputOptions: jest.fn().mockReturnThis(),
      output: jest.fn().mockReturnThis(),
      on: jest.fn().mockImplementation(function (
        this: FfmpegCommand,
        event: string,
        callback: (...args: unknown[]) => void,
      ) {
        if (!allCallbacks[event]) {
          allCallbacks[event] = [];
        }
        allCallbacks[event].push(callback);
        eventCallbacks[event] = callback;
        return this;
      }),
      run: jest.fn().mockImplementation(() => {
        process.nextTick(() => {
          if (allCallbacks.end) {
            allCallbacks.end.forEach((cb) => cb());
          }
        });
      }),
      kill: jest.fn(),
    };

    mockFfmpegProvider.createCommand.mockReturnValue(mockCommand);

    const { unit, unitRef } = await TestBed.solitary(ThumbnailService)
      .mock(FfmpegProvider)
      .final(mockFfmpegProvider)
      .compile();

    service = unit;
    storageService = unitRef.get(StorageService);

    storageService.ensureDirectory.mockResolvedValue(undefined);
    storageService.deleteFile.mockResolvedValue(undefined);
    storageService.createReadStream.mockReturnValue({} as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateVideoThumbnail', () => {
    const filePath = '/uploads/videos/test-video.mp4';
    const fileId = 'file-abc-123';

    it('should ensure thumbnail directory, run ffmpeg, and return the thumbnail path', async () => {
      const result = await service.generateVideoThumbnail(filePath, fileId);

      expect(storageService.ensureDirectory).toHaveBeenCalledWith(
        'uploads/thumbnails',
      );
      expect(mockCommand.run).toHaveBeenCalled();
      expect(result).toBe('uploads/thumbnails/file-abc-123.jpg');
    });

    it('should return null when ffmpeg emits an error', async () => {
      mockCommand.run.mockImplementationOnce(() => {
        process.nextTick(() => {
          if (allCallbacks.error) {
            allCallbacks.error.forEach((cb) => cb(new Error('FFmpeg crashed')));
          }
        });
      });

      const result = await service.generateVideoThumbnail(filePath, fileId);

      expect(result).toBeNull();
    });

    it('should return null when ensureDirectory fails', async () => {
      storageService.ensureDirectory.mockRejectedValueOnce(
        new Error('Permission denied'),
      );

      const result = await service.generateVideoThumbnail(filePath, fileId);

      expect(result).toBeNull();
      expect(mockCommand.run).not.toHaveBeenCalled();
    });

    it('should use correct ffmpeg input options', async () => {
      await service.generateVideoThumbnail(filePath, fileId);

      expect(mockCommand.input).toHaveBeenCalledWith(filePath);
      expect(mockCommand.inputOptions).toHaveBeenCalledWith('-ss', '1');
    });

    it('should use correct ffmpeg output options', async () => {
      await service.generateVideoThumbnail(filePath, fileId);

      expect(mockCommand.outputOptions).toHaveBeenCalledWith(
        '-vframes',
        '1',
        '-vf',
        'scale=480:-1',
        '-f',
        'image2',
        '-q:v',
        '5',
      );
      expect(mockCommand.output).toHaveBeenCalledWith(
        'uploads/thumbnails/file-abc-123.jpg',
      );
    });

    it('should construct the thumbnail path from uploadsDir and fileId', async () => {
      const result = await service.generateVideoThumbnail(
        '/some/other/video.mp4',
        'unique-file-id',
      );

      // uploadsDir defaults to './uploads' when ConfigService returns undefined;
      // path.join normalizes it to 'uploads/thumbnails'
      expect(result).toBe('uploads/thumbnails/unique-file-id.jpg');
      expect(storageService.ensureDirectory).toHaveBeenCalledWith(
        'uploads/thumbnails',
      );
    });

    it('should register end and error event handlers', async () => {
      await service.generateVideoThumbnail(filePath, fileId);

      expect(mockCommand.on).toHaveBeenCalledWith('end', expect.any(Function));
      expect(mockCommand.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
    });

    it('should kill ffmpeg and return null on timeout', async () => {
      jest.useFakeTimers();

      try {
        mockCommand.run.mockImplementation(() => {
          // Do NOT fire 'end' or 'error' — simulates a hung process
        });

        const resultPromise = service.generateVideoThumbnail(filePath, fileId);

        // Advance past the 30-second timeout
        await jest.advanceTimersByTimeAsync(30_001);

        const result = await resultPromise;

        expect(result).toBeNull();
        expect(mockCommand.kill).toHaveBeenCalledWith('SIGKILL');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should call run on the ffmpeg command', async () => {
      await service.generateVideoThumbnail(filePath, fileId);

      expect(mockCommand.run).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateImageThumbnail', () => {
    const filePath = '/uploads/images/photo.jpg';
    const fileId = 'file-image-1';
    const scaleFilter =
      "scale='min(480,iw)':'min(480,ih)':force_original_aspect_ratio=decrease";

    const generate = (dimensions?: { width: number; height: number } | null) =>
      service.generateImageThumbnail(
        filePath,
        fileId,
        StorageType.LOCAL,
        'image/jpeg',
        dimensions,
      );

    it('generates a bounded JPEG for a landscape image', async () => {
      const result = await generate({ width: 1600, height: 900 });

      expect(storageService.ensureDirectory).toHaveBeenCalledWith(
        'uploads/thumbnails',
      );
      expect(mockCommand.input).toHaveBeenCalledWith(filePath);
      expect(mockCommand.outputOptions).toHaveBeenCalledWith(
        '-frames:v',
        '1',
        '-vf',
        scaleFilter,
        '-map_metadata',
        '-1',
        '-f',
        'image2',
        '-q:v',
        '5',
      );
      expect(mockCommand.output).toHaveBeenCalledWith(
        'uploads/thumbnails/file-image-1.jpg',
      );
      expect(result).toBe('uploads/thumbnails/file-image-1.jpg');
    });

    it('uses the same bound for a portrait image', async () => {
      const result = await generate({ width: 900, height: 1600 });

      expect(mockCommand.outputOptions).toHaveBeenCalledWith(
        '-frames:v',
        '1',
        '-vf',
        scaleFilter,
        '-map_metadata',
        '-1',
        '-f',
        'image2',
        '-q:v',
        '5',
      );
      expect(result).toBe('uploads/thumbnails/file-image-1.jpg');
    });

    it('keeps the default autorotate (EXIF orientation) and strips that metadata', async () => {
      await generate({ width: 1600, height: 900 });

      // Never `-noautorotate`: the default rotates EXIF-oriented photos.
      expect(mockCommand.inputOptions).not.toHaveBeenCalled();
      const options = (mockCommand.outputOptions as jest.Mock).mock
        .calls[0] as string[];
      expect(options).toContain('-map_metadata');
      expect(options[options.indexOf('-map_metadata') + 1]).toBe('-1');
    });

    it('skips an image whose longest side is already the bound', async () => {
      const result = await generate({ width: 480, height: 320 });

      expect(result).toBeNull();
      expect(mockFfmpegProvider.createCommand).not.toHaveBeenCalled();
      expect(storageService.ensureDirectory).not.toHaveBeenCalled();
    });

    it('generates for an image one pixel over the bound', async () => {
      const result = await generate({ width: 481, height: 100 });

      expect(result).toBe('uploads/thumbnails/file-image-1.jpg');
      expect(mockCommand.run).toHaveBeenCalledTimes(1);
    });

    it('generates when the dimensions are unknown, without upscaling in the filter', async () => {
      const result = await generate(null);

      expect(result).toBe('uploads/thumbnails/file-image-1.jpg');
      expect(mockCommand.outputOptions).toHaveBeenCalledWith(
        '-frames:v',
        '1',
        '-vf',
        scaleFilter,
        '-map_metadata',
        '-1',
        '-f',
        'image2',
        '-q:v',
        '5',
      );
    });

    it('skips SVG, which has no raster pixels to thumbnail', async () => {
      const result = await service.generateImageThumbnail(
        '/uploads/images/logo.svg',
        'file-svg-1',
        StorageType.LOCAL,
        'image/svg+xml',
        { width: 2000, height: 1000 },
      );

      expect(result).toBeNull();
      expect(mockFfmpegProvider.createCommand).not.toHaveBeenCalled();
    });

    it('skips MIME types that are not images', async () => {
      const result = await service.generateImageThumbnail(
        '/uploads/docs/file.pdf',
        'file-pdf-1',
        StorageType.LOCAL,
        'application/pdf',
        { width: 2000, height: 1000 },
      );

      expect(result).toBeNull();
      expect(mockFfmpegProvider.createCommand).not.toHaveBeenCalled();
    });

    it('returns null when ffmpeg cannot decode a corrupt image', async () => {
      mockCommand.run.mockImplementationOnce(() => {
        process.nextTick(() => {
          if (allCallbacks.error) {
            allCallbacks.error.forEach((cb) =>
              cb(new Error('Invalid data found when processing input')),
            );
          }
        });
      });

      const result = await generate({ width: 1600, height: 900 });

      expect(result).toBeNull();
    });

    it('returns null when the thumbnail directory cannot be written', async () => {
      storageService.ensureDirectory.mockRejectedValueOnce(
        new Error('Permission denied'),
      );

      const result = await generate({ width: 1600, height: 900 });

      expect(result).toBeNull();
      expect(mockCommand.run).not.toHaveBeenCalled();
    });

    it('kills ffmpeg and returns null when image extraction times out', async () => {
      jest.useFakeTimers();

      try {
        mockCommand.run.mockImplementation(() => {
          // Hung process: no 'end' or 'error'.
        });

        const resultPromise = generate({ width: 1600, height: 900 });

        await jest.advanceTimersByTimeAsync(30_001);

        expect(await resultPromise).toBeNull();
        expect(mockCommand.kill).toHaveBeenCalledWith('SIGKILL');
      } finally {
        jest.useRealTimers();
      }
    });

    it('uploads the JPEG and removes the scratch file for S3 storage', async () => {
      const provider = {
        writeStream: jest.fn().mockResolvedValue({ size: 1024 }),
      } as unknown as jest.Mocked<IStorageProvider>;
      storageService.getProvider.mockReturnValue(provider);

      const result = await service.generateImageThumbnail(
        filePath,
        fileId,
        StorageType.S3,
        'image/jpeg',
        { width: 1600, height: 900 },
      );

      expect(provider.writeStream).toHaveBeenCalledWith(
        'thumbnails/file-image-1.jpg',
        expect.anything(),
        { contentType: 'image/jpeg' },
      );
      expect(storageService.deleteFile).toHaveBeenCalledWith(
        'uploads/thumbnails/file-image-1.jpg.tmp',
      );
      expect(result).toBe('thumbnails/file-image-1.jpg');
    });

    it('returns null but still removes the scratch file when the S3 upload fails', async () => {
      const provider = {
        writeStream: jest.fn().mockRejectedValue(new Error('S3 unreachable')),
      } as unknown as jest.Mocked<IStorageProvider>;
      storageService.getProvider.mockReturnValue(provider);

      const result = await service.generateImageThumbnail(
        filePath,
        fileId,
        StorageType.S3,
        'image/jpeg',
        { width: 1600, height: 900 },
      );

      expect(result).toBeNull();
      expect(storageService.deleteFile).toHaveBeenCalledWith(
        'uploads/thumbnails/file-image-1.jpg.tmp',
      );
    });
  });
});
