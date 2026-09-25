import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ThumbnailService } from './thumbnail.service';
import { StorageService } from '@/storage/storage.service';
import {
  FfmpegProvider,
  FfmpegCommand,
} from '@/livekit/providers/ffmpeg.provider';

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
});
