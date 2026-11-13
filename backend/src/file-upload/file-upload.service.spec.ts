/* eslint-disable @typescript-eslint/no-require-imports */
import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { FileUploadService } from './file-upload.service';
import { DatabaseService } from '@/database/database.service';
import { StorageService } from '@/storage/storage.service';
import { StorageQuotaService } from '@/storage-quota/storage-quota.service';
import { ThumbnailService } from '@/file/thumbnail.service';
import { MediaDimensionsService } from '@/file/media-dimensions.service';
import {
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PermissionsService } from '@/roles/permissions.service';
import { FfmpegProvider } from '@/livekit/providers/ffmpeg.provider';
import { ResourceType, FileType, StorageType } from '@prisma/client';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import type { IStorageProvider } from '@/storage/interfaces/storage-provider.interface';
import { FileUploadResponseDto } from './dto/file-upload-response.dto';
import { FileFactory } from '@/test-utils';

jest.mock('./validators/resource-type-file.validator');

describe('FileUploadService', () => {
  let service: FileUploadService;
  let databaseService: Mocked<DatabaseService>;
  let storageService: Mocked<StorageService>;
  let storageQuotaService: Mocked<StorageQuotaService>;
  let thumbnailService: Mocked<ThumbnailService>;
  let mediaDimensionsService: Mocked<MediaDimensionsService>;
  let permissionsService: Mocked<PermissionsService>;
  let ffmpegProvider: Mocked<FfmpegProvider>;
  let ffprobe: jest.Mock;
  let mockS3Provider: jest.Mocked<IStorageProvider>;

  const mockUser = {
    id: 'user-123',
    username: 'testuser',
    email: 'test@example.com',
  } as any;

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'test.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 1024,
    destination: '/tmp',
    filename: 'test-123.png',
    path: '/tmp/test-123.png',
    buffer: Buffer.from('test'),
    stream: null as any,
  };

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(FileUploadService).compile();

    service = unit;
    databaseService = unitRef.get(DatabaseService);
    storageService = unitRef.get(StorageService);
    storageQuotaService = unitRef.get(StorageQuotaService);
    thumbnailService = unitRef.get(ThumbnailService);
    mediaDimensionsService = unitRef.get(MediaDimensionsService);
    permissionsService = unitRef.get(PermissionsService);
    ffmpegProvider = unitRef.get(FfmpegProvider);
    ffprobe = ffmpegProvider.ffprobe as jest.Mock;

    // Reset mocks
    jest.clearAllMocks();
    ffprobe.mockResolvedValue({ format: { duration: 5 } });

    // The fixtures upload for the user's own message.
    (databaseService.message.findUnique as jest.Mock).mockResolvedValue({
      authorId: mockUser.id,
    });

    // Default mock implementations - use StorageService instead of direct fs calls.
    // Checksum computation streams the file through createReadStream (never
    // buffers the whole file) — give it a real async-iterable stream.
    storageService.createReadStream.mockImplementation(
      () => Readable.from([Buffer.from('test')]) as any,
    );
    storageService.deleteFile.mockResolvedValue(undefined);
    // Default active storage type: LOCAL (zero-behavior-change default).
    storageService.getDefaultStorageType.mockReturnValue(StorageType.LOCAL);
    mockS3Provider = {
      writeStream: jest.fn().mockResolvedValue({ size: 1024 }),
      getReadStream: jest.fn(),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      fileExists: jest.fn(),
      getFileStats: jest.fn(),
      getFileUrl: jest.fn(),
    };
    storageService.getProvider.mockReturnValue(mockS3Provider);

    // Dimensions are best-effort; nothing known by default.
    mediaDimensionsService.read.mockResolvedValue(null);

    // Default quota check passes
    storageQuotaService.canUploadFile.mockResolvedValue({
      canUpload: true,
      currentUsedBytes: 0,
      quotaBytes: 1000000000,
      requestedBytes: 1024,
      remainingBytes: 999998976,
    });
    storageQuotaService.reserveStorage.mockResolvedValue(true);
    storageQuotaService.decrementUserStorage.mockResolvedValue(undefined);

    // Mock crypto
    const mockHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('abc123def456'),
    };
    jest.spyOn(crypto, 'createHash').mockReturnValue(mockHash as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have database service', () => {
    expect(databaseService).toBeDefined();
  });

  describe('uploadFile', () => {
    it('should successfully upload a valid file', async () => {
      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      const createdFile = {
        id: 'file-123',
        filename: 'test.png',
        mimeType: 'image/png',
        size: 1024,
        checksum: 'abc123def456',
      };

      databaseService.file.create.mockResolvedValue(createdFile as any);

      // Mock validator to pass

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));

      const result = await service.uploadFile(mockFile, createDto, mockUser);

      expect(result).toMatchObject(createdFile);
      expect(result.hasThumbnail).toBe(false);
      expect(databaseService.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          resourceType: ResourceType.MESSAGE_ATTACHMENT,
          fileMessageId: 'msg-123',
          filename: 'test.png',
          mimeType: 'image/png',
          fileType: FileType.IMAGE,
          size: 1024,
          checksum: 'abc123def456',
          uploadedById: 'user-123',
          storageType: StorageType.LOCAL,
          storagePath: '/tmp/test-123.png',
        }),
      });
    });

    it('should return a FileUploadResponseDto instance, not a raw Prisma object', async () => {
      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      const createdFile = {
        id: 'file-123',
        filename: 'test.png',
        mimeType: 'image/png',
        size: 1024,
        checksum: 'abc123def456',
      };

      databaseService.file.create.mockResolvedValue(createdFile as any);

      // Mock validator to pass

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));

      const result = await service.uploadFile(mockFile, createDto, mockUser);

      expect(result).toBeInstanceOf(FileUploadResponseDto);
    });

    describe('video thumbnail generation', () => {
      const videoFile: Express.Multer.File = {
        ...mockFile,
        originalname: 'clip.mp4',
        mimetype: 'video/mp4',
        filename: 'clip-123.mp4',
        path: '/tmp/clip-123.mp4',
      };

      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      const createdFile = {
        id: 'file-video-1',
        filename: 'clip.mp4',
        mimeType: 'video/mp4',
        fileType: FileType.VIDEO,
        thumbnailPath: null,
      };

      beforeEach(() => {
        databaseService.file.create.mockResolvedValue(createdFile as any);

        const {
          ResourceTypeFileValidator,
        } = require('./validators/resource-type-file.validator');
        ResourceTypeFileValidator.mockImplementation(() => ({
          isValid: jest.fn().mockResolvedValue(true),
        }));
      });

      it('should generate the thumbnail before responding and return the updated record', async () => {
        thumbnailService.generateVideoThumbnail.mockResolvedValue(
          'uploads/thumbnails/file-video-1.jpg',
        );
        databaseService.file.update.mockResolvedValue({
          ...createdFile,
          thumbnailPath: 'uploads/thumbnails/file-video-1.jpg',
        } as any);

        const result = await service.uploadFile(videoFile, createDto, mockUser);

        expect(thumbnailService.generateVideoThumbnail).toHaveBeenCalledWith(
          '/tmp/clip-123.mp4',
          'file-video-1',
          StorageType.LOCAL,
        );
        expect(databaseService.file.update).toHaveBeenCalledWith({
          where: { id: 'file-video-1' },
          data: { thumbnailPath: 'uploads/thumbnails/file-video-1.jpg' },
        });
        expect(result.thumbnailPath).toBe(
          'uploads/thumbnails/file-video-1.jpg',
        );
      });

      it('should still succeed when thumbnail generation returns null', async () => {
        thumbnailService.generateVideoThumbnail.mockResolvedValue(null);

        const result = await service.uploadFile(videoFile, createDto, mockUser);

        expect(result.id).toBe('file-video-1');
        expect(result.thumbnailPath).toBeNull();
        expect(databaseService.file.update).not.toHaveBeenCalled();
      });

      it('should still succeed when thumbnail generation throws', async () => {
        thumbnailService.generateVideoThumbnail.mockRejectedValue(
          new Error('FFmpeg crashed'),
        );

        const result = await service.uploadFile(videoFile, createDto, mockUser);

        expect(result.id).toBe('file-video-1');
        expect(result.thumbnailPath).toBeNull();
      });

      it('should generate an image thumbnail instead of a video thumbnail', async () => {
        databaseService.file.create.mockResolvedValue(
          FileFactory.buildImage({ id: 'file-img-1' }),
        );
        thumbnailService.generateImageThumbnail.mockResolvedValue(
          'uploads/thumbnails/file-img-1.jpg',
        );
        databaseService.file.update.mockResolvedValue(
          FileFactory.buildImage({
            id: 'file-img-1',
            thumbnailPath: 'uploads/thumbnails/file-img-1.jpg',
          }),
        );

        const result = await service.uploadFile(mockFile, createDto, mockUser);

        expect(thumbnailService.generateVideoThumbnail).not.toHaveBeenCalled();
        expect(thumbnailService.generateImageThumbnail).toHaveBeenCalledWith(
          '/tmp/test-123.png',
          'file-img-1',
          StorageType.LOCAL,
          'image/png',
          null,
        );
        expect(result.hasThumbnail).toBe(true);
      });

      it('still succeeds when image thumbnail generation returns null (small or SVG)', async () => {
        databaseService.file.create.mockResolvedValue(
          FileFactory.buildImage({ id: 'file-img-2' }),
        );
        thumbnailService.generateImageThumbnail.mockResolvedValue(null);

        const result = await service.uploadFile(mockFile, createDto, mockUser);

        expect(result.id).toBe('file-img-2');
        expect(result.hasThumbnail).toBe(false);
        expect(databaseService.file.update).not.toHaveBeenCalled();
      });

      it('still succeeds when image thumbnail generation throws', async () => {
        databaseService.file.create.mockResolvedValue(
          FileFactory.buildImage({ id: 'file-img-3' }),
        );
        thumbnailService.generateImageThumbnail.mockRejectedValue(
          new Error('FFmpeg crashed'),
        );

        const result = await service.uploadFile(mockFile, createDto, mockUser);

        expect(result.id).toBe('file-img-3');
        expect(result.hasThumbnail).toBe(false);
      });

      it('should not generate thumbnails for audio, document or other files', async () => {
        for (const [mimetype, fileType] of [
          ['audio/mpeg', FileType.AUDIO],
          ['application/pdf', FileType.DOCUMENT],
          ['application/zip', FileType.OTHER],
        ] as const) {
          databaseService.file.create.mockResolvedValue(
            FileFactory.build({
              id: `file-${fileType}`,
              fileType,
            }),
          );

          await service.uploadFile(
            { ...mockFile, mimetype },
            createDto,
            mockUser,
          );

          expect(
            thumbnailService.generateVideoThumbnail,
          ).not.toHaveBeenCalled();
          expect(
            thumbnailService.generateImageThumbnail,
          ).not.toHaveBeenCalled();
        }
      });
    });

    describe('attachment dimensions', () => {
      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      beforeEach(() => {
        databaseService.file.create.mockResolvedValue({
          id: 'file-image-1',
          fileType: FileType.IMAGE,
        } as any);

        const {
          ResourceTypeFileValidator,
        } = require('./validators/resource-type-file.validator');
        ResourceTypeFileValidator.mockImplementation(() => ({
          isValid: jest.fn().mockResolvedValue(true),
        }));
      });

      it('stores the dimensions the probe reports for an image', async () => {
        mediaDimensionsService.read.mockResolvedValue({
          width: 800,
          height: 600,
        });

        await service.uploadFile(mockFile, createDto, mockUser);

        expect(mediaDimensionsService.read).toHaveBeenCalledWith(
          '/tmp/test-123.png',
          'image/png',
        );
        expect(databaseService.file.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ width: 800, height: 600 }),
        });
      });

      it('still uploads, with null dimensions, when the probe has none', async () => {
        mediaDimensionsService.read.mockResolvedValue(null);

        const result = await service.uploadFile(mockFile, createDto, mockUser);

        expect(databaseService.file.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ width: null, height: null }),
        });
        expect(result.id).toBe('file-image-1');
      });
    });

    it('should throw error and cleanup file when validation fails', async () => {
      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      // Mock validator to fail

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(false),
        buildErrorMessage: jest.fn().mockReturnValue('File validation failed'),
      }));

      await expect(
        service.uploadFile(mockFile, createDto, mockUser),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(storageService.deleteFile).toHaveBeenCalledWith(
        '/tmp/test-123.png',
      );
      expect(databaseService.file.create).not.toHaveBeenCalled();
    });

    describe('quota reservation', () => {
      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };
      const validatorPasses = (valid = true) => {
        const {
          ResourceTypeFileValidator,
        } = require('./validators/resource-type-file.validator');
        ResourceTypeFileValidator.mockImplementation(() => ({
          isValid: jest.fn().mockResolvedValue(valid),
          buildErrorMessage: jest.fn().mockReturnValue('invalid'),
        }));
      };

      it('reserves the file size once, with no separate increment', async () => {
        validatorPasses();
        databaseService.file.create.mockResolvedValue({ id: 'f1' } as any);

        await service.uploadFile(mockFile, createDto, mockUser);

        expect(storageQuotaService.reserveStorage).toHaveBeenCalledWith(
          mockUser.id,
          mockFile.size,
        );
        expect(storageQuotaService.incrementUserStorage).not.toHaveBeenCalled();
        expect(storageQuotaService.decrementUserStorage).not.toHaveBeenCalled();
      });

      it('answers 413 and stores nothing when the reservation does not fit', async () => {
        validatorPasses();
        storageQuotaService.reserveStorage.mockResolvedValue(false);

        await expect(
          service.uploadFile(mockFile, createDto, mockUser),
        ).rejects.toThrow(PayloadTooLargeException);

        expect(storageService.deleteFile).toHaveBeenCalledWith(mockFile.path);
        expect(databaseService.file.create).not.toHaveBeenCalled();
        expect(storageQuotaService.decrementUserStorage).not.toHaveBeenCalled();
      });

      it('reserves nothing for a file that fails validation', async () => {
        validatorPasses(false);

        await expect(
          service.uploadFile(mockFile, createDto, mockUser),
        ).rejects.toThrow(UnprocessableEntityException);

        expect(storageQuotaService.reserveStorage).not.toHaveBeenCalled();
      });

      it('releases the reservation when the database insert fails', async () => {
        validatorPasses();
        databaseService.file.create.mockRejectedValue(new Error('db down'));

        await expect(
          service.uploadFile(mockFile, createDto, mockUser),
        ).rejects.toThrow('db down');

        expect(storageQuotaService.decrementUserStorage).toHaveBeenCalledWith(
          mockUser.id,
          mockFile.size,
        );
      });

      it('releases the reservation when the S3 upload fails', async () => {
        validatorPasses();
        storageService.getDefaultStorageType.mockReturnValue(StorageType.S3);
        mockS3Provider.writeStream.mockRejectedValue(new Error('S3 down'));

        await expect(
          service.uploadFile(mockFile, createDto, mockUser),
        ).rejects.toThrow('S3 down');

        expect(storageQuotaService.decrementUserStorage).toHaveBeenCalledWith(
          mockUser.id,
          mockFile.size,
        );
      });
    });

    it('should cleanup file if database insert fails', async () => {
      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      // Mock validator to pass

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));

      databaseService.file.create.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        service.uploadFile(mockFile, createDto, mockUser),
      ).rejects.toThrow('Database error');

      expect(storageService.deleteFile).toHaveBeenCalledWith(
        '/tmp/test-123.png',
      );
    });

    it('should handle video file type', async () => {
      const videoFile = {
        ...mockFile,
        originalname: 'test.mp4',
        mimetype: 'video/mp4',
      };

      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      databaseService.file.create.mockResolvedValue({ id: 'file-123' } as any);

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));

      await service.uploadFile(videoFile, createDto, mockUser);

      expect(databaseService.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fileType: FileType.VIDEO,
        }),
      });
    });

    it('should handle audio file type', async () => {
      const audioFile = {
        ...mockFile,
        originalname: 'test.mp3',
        mimetype: 'audio/mpeg',
      };

      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      databaseService.file.create.mockResolvedValue({ id: 'file-123' } as any);

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));

      await service.uploadFile(audioFile, createDto, mockUser);

      expect(databaseService.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fileType: FileType.AUDIO,
        }),
      });
    });

    it('should handle document file types', async () => {
      const documentTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'text/plain',
      ];

      for (const mimeType of documentTypes) {
        const docFile = {
          ...mockFile,
          mimetype: mimeType,
        };

        const createDto = {
          resourceType: ResourceType.MESSAGE_ATTACHMENT,
          resourceId: 'msg-123',
        };

        databaseService.file.create.mockResolvedValue({
          id: 'file-123',
        } as any);

        const {
          ResourceTypeFileValidator,
        } = require('./validators/resource-type-file.validator');
        ResourceTypeFileValidator.mockImplementation(() => ({
          isValid: jest.fn().mockResolvedValue(true),
        }));

        await service.uploadFile(docFile, createDto, mockUser);

        expect(databaseService.file.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            fileType: FileType.DOCUMENT,
          }),
        });

        jest.clearAllMocks();
      }
    });

    it('should handle archive file types as OTHER', async () => {
      const archiveTypes = [
        'application/zip',
        'application/x-rar-compressed',
        'application/x-7z-compressed',
        'application/octet-stream',
      ];

      for (const mimeType of archiveTypes) {
        const archiveFile = {
          ...mockFile,
          mimetype: mimeType,
        };

        const createDto = {
          resourceType: ResourceType.MESSAGE_ATTACHMENT,
          resourceId: 'msg-123',
        };

        databaseService.file.create.mockResolvedValue({
          id: 'file-123',
        } as any);

        const {
          ResourceTypeFileValidator,
        } = require('./validators/resource-type-file.validator');
        ResourceTypeFileValidator.mockImplementation(() => ({
          isValid: jest.fn().mockResolvedValue(true),
        }));

        await service.uploadFile(archiveFile, createDto, mockUser);

        expect(databaseService.file.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            fileType: FileType.OTHER,
          }),
        });

        jest.clearAllMocks();
      }
    });

    it('should generate thumbnail for video uploads (fire-and-forget)', async () => {
      const videoFile = {
        ...mockFile,
        originalname: 'clip.mp4',
        mimetype: 'video/mp4',
        path: '/tmp/clip.mp4',
      };
      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      databaseService.file.create.mockResolvedValue({
        id: 'file-video-1',
      } as any);
      databaseService.file.update.mockResolvedValue({} as any);
      thumbnailService.generateVideoThumbnail.mockResolvedValue(
        '/uploads/thumbnails/file-video-1.jpg',
      );

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));

      await service.uploadFile(videoFile, createDto, mockUser);

      // Flush the fire-and-forget microtask
      await new Promise(process.nextTick);

      expect(thumbnailService.generateVideoThumbnail).toHaveBeenCalledWith(
        '/tmp/clip.mp4',
        'file-video-1',
        StorageType.LOCAL,
      );
      expect(databaseService.file.update).toHaveBeenCalledWith({
        where: { id: 'file-video-1' },
        data: { thumbnailPath: '/uploads/thumbnails/file-video-1.jpg' },
      });
    });

    it('should generate an image thumbnail for image uploads', async () => {
      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      databaseService.file.create.mockResolvedValue(
        FileFactory.buildImage({ id: 'file-img-1' }),
      );
      thumbnailService.generateImageThumbnail.mockResolvedValue(
        '/uploads/thumbnails/file-img-1.jpg',
      );
      databaseService.file.update.mockResolvedValue(
        FileFactory.buildImage({
          id: 'file-img-1',
          thumbnailPath: '/uploads/thumbnails/file-img-1.jpg',
        }),
      );

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));

      await service.uploadFile(mockFile, createDto, mockUser);

      expect(thumbnailService.generateImageThumbnail).toHaveBeenCalledWith(
        '/tmp/test-123.png',
        'file-img-1',
        StorageType.LOCAL,
        'image/png',
        null,
      );
    });

    it('should not update file record when thumbnail generation fails', async () => {
      const videoFile = {
        ...mockFile,
        originalname: 'bad.mp4',
        mimetype: 'video/mp4',
      };
      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      databaseService.file.create.mockResolvedValue({
        id: 'file-bad-1',
      } as any);
      thumbnailService.generateVideoThumbnail.mockResolvedValue(null);

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));

      const result = await service.uploadFile(videoFile, createDto, mockUser);

      // Flush the fire-and-forget microtask
      await new Promise(process.nextTick);

      expect(result).toBeDefined();
      expect(thumbnailService.generateVideoThumbnail).toHaveBeenCalled();
      // Should NOT update the file record with null thumbnailPath
      expect(databaseService.file.update).not.toHaveBeenCalled();
    });

    it('should generate correct checksum', async () => {
      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      databaseService.file.create.mockResolvedValue({ id: 'file-123' } as any);

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));

      await service.uploadFile(mockFile, createDto, mockUser);

      expect(storageService.createReadStream).toHaveBeenCalledWith(
        '/tmp/test-123.png',
      );
      expect(crypto.createHash).toHaveBeenCalledWith('sha256');
      expect(databaseService.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          checksum: 'abc123def456',
        }),
      });
    });
  });

  describe('uploadFile — soundboard sound duration', () => {
    const soundFile: Express.Multer.File = {
      ...mockFile,
      originalname: 'sound.mp3',
      mimetype: 'audio/mpeg',
      filename: 'sound-123.mp3',
      path: '/tmp/sound-123.mp3',
      size: 2048,
    };
    const createDto = {
      resourceType: ResourceType.SOUNDBOARD_SOUND,
      resourceId: 'community-1',
    };

    beforeEach(() => {
      permissionsService.verifyActionsForUserAndResource.mockResolvedValue(
        true,
      );
      (databaseService.file.create as jest.Mock).mockResolvedValue({
        id: 'file-sound-1',
        filename: 'sound.mp3',
        mimeType: 'audio/mpeg',
        size: 2048,
        checksum: 'abc123def456',
      });

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));
    });

    it('accepts a sound under the limit', async () => {
      ffprobe.mockResolvedValue({ format: { duration: 12.5 } });

      await expect(
        service.uploadFile(soundFile, createDto, mockUser),
      ).resolves.toBeInstanceOf(FileUploadResponseDto);
      expect(ffmpegProvider.ffprobe).toHaveBeenCalledWith('/tmp/sound-123.mp3');
      expect(databaseService.file.create).toHaveBeenCalled();
    });

    it('accepts a sound exactly at the limit', async () => {
      ffprobe.mockResolvedValue({ format: { duration: 30 } });

      await expect(
        service.uploadFile(soundFile, createDto, mockUser),
      ).resolves.toBeInstanceOf(FileUploadResponseDto);
    });

    it('rejects a sound longer than the limit, with 400 and no file row', async () => {
      ffprobe.mockResolvedValue({ format: { duration: 30.5 } });

      const error: unknown = await service
        .uploadFile(soundFile, createDto, mockUser)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as BadRequestException).message).toContain('30 seconds');
      expect(databaseService.file.create).not.toHaveBeenCalled();
      expect(storageService.deleteFile).toHaveBeenCalledWith(
        '/tmp/sound-123.mp3',
      );
    });

    it('rejects a sound whose length cannot be read as an invalid sound', async () => {
      ffprobe.mockRejectedValue(new Error('Invalid data'));

      const error: unknown = await service
        .uploadFile(soundFile, createDto, mockUser)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as BadRequestException).message).toContain(
        'Could not read the length',
      );
      expect(databaseService.file.create).not.toHaveBeenCalled();
      expect(storageService.deleteFile).toHaveBeenCalledWith(
        '/tmp/sound-123.mp3',
      );
    });

    it('does not probe the length of other resource types', async () => {
      await service.uploadFile(
        mockFile,
        {
          resourceType: ResourceType.MESSAGE_ATTACHMENT,
          resourceId: 'msg-123',
        },
        mockUser,
      );

      expect(ffmpegProvider.ffprobe).not.toHaveBeenCalled();
    });
  });

  describe('uploadFile — S3 storage (STORAGE_TYPE=S3)', () => {
    const createDto = {
      resourceType: ResourceType.MESSAGE_ATTACHMENT,
      resourceId: 'msg-123',
    };

    beforeEach(() => {
      storageService.getDefaultStorageType.mockReturnValue(StorageType.S3);

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));
    });

    it('streams the staged tmp file to the S3 provider and persists the bare filename as the key', async () => {
      databaseService.file.create.mockResolvedValue({
        id: 'file-s3-1',
      } as any);

      await service.uploadFile(mockFile, createDto, mockUser);

      expect(storageService.getProvider).toHaveBeenCalledWith(StorageType.S3);
      expect(mockS3Provider.writeStream).toHaveBeenCalledWith(
        'test-123.png', // file.filename — bare multer-generated key
        expect.anything(),
        { contentType: 'image/png' },
      );
      expect(databaseService.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          storageType: StorageType.S3,
          storagePath: 'test-123.png',
        }),
      });
    });

    it('deletes the local tmp file after a successful S3 upload + DB insert', async () => {
      databaseService.file.create.mockResolvedValue({
        id: 'file-s3-2',
      } as any);

      await service.uploadFile(mockFile, createDto, mockUser);

      expect(storageService.deleteFile).toHaveBeenCalledWith(
        '/tmp/test-123.png',
      );
    });

    it('never deletes the local tmp path for LOCAL uploads (it IS the permanent storage)', async () => {
      storageService.getDefaultStorageType.mockReturnValue(StorageType.LOCAL);
      databaseService.file.create.mockResolvedValue({
        id: 'file-local-1',
      } as any);

      await service.uploadFile(mockFile, createDto, mockUser);

      expect(storageService.deleteFile).not.toHaveBeenCalled();
    });

    it('cleans up the local tmp file and rethrows when the S3 upload itself fails', async () => {
      mockS3Provider.writeStream.mockRejectedValue(new Error('S3 unreachable'));

      await expect(
        service.uploadFile(mockFile, createDto, mockUser),
      ).rejects.toThrow('S3 unreachable');

      expect(storageService.deleteFile).toHaveBeenCalledWith(
        '/tmp/test-123.png',
      );
      expect(databaseService.file.create).not.toHaveBeenCalled();
    });

    it('cleans up both the local tmp file AND the orphaned S3 object when the DB insert fails after a successful upload', async () => {
      databaseService.file.create.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        service.uploadFile(mockFile, createDto, mockUser),
      ).rejects.toThrow('Database error');

      expect(storageService.deleteFile).toHaveBeenCalledWith(
        '/tmp/test-123.png',
      );
      expect(mockS3Provider.deleteFile).toHaveBeenCalledWith('test-123.png');
    });

    it('does not attempt to clean up a remote object when the DB fails for a LOCAL upload', async () => {
      storageService.getDefaultStorageType.mockReturnValue(StorageType.LOCAL);
      databaseService.file.create.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        service.uploadFile(mockFile, createDto, mockUser),
      ).rejects.toThrow('Database error');

      expect(mockS3Provider.deleteFile).not.toHaveBeenCalled();
    });

    it('passes the S3 storageType through to thumbnail generation for video uploads', async () => {
      const videoFile = {
        ...mockFile,
        originalname: 'clip.mp4',
        mimetype: 'video/mp4',
        filename: 'clip-123.mp4',
        path: '/tmp/clip-123.mp4',
      };
      databaseService.file.create.mockResolvedValue({
        id: 'file-video-s3',
      } as any);
      thumbnailService.generateVideoThumbnail.mockResolvedValue(
        'thumbnails/file-video-s3.jpg',
      );
      databaseService.file.update.mockResolvedValue({} as any);

      await service.uploadFile(videoFile, createDto, mockUser);

      expect(thumbnailService.generateVideoThumbnail).toHaveBeenCalledWith(
        '/tmp/clip-123.mp4',
        'file-video-s3',
        StorageType.S3,
      );
      // tmp cleanup happens only after thumbnail generation completes
      expect(storageService.deleteFile).toHaveBeenCalledWith(
        '/tmp/clip-123.mp4',
      );
    });

    it('passes the S3 storageType through to image thumbnail generation', async () => {
      const imageFile = {
        ...mockFile,
        originalname: 'photo.png',
        mimetype: 'image/png',
        filename: 'photo-123.png',
        path: '/tmp/photo-123.png',
      };
      databaseService.file.create.mockResolvedValue(
        FileFactory.buildImage({ id: 'file-image-s3' }),
      );
      thumbnailService.generateImageThumbnail.mockResolvedValue(
        'thumbnails/file-image-s3.jpg',
      );
      databaseService.file.update.mockResolvedValue(
        FileFactory.buildImage({
          id: 'file-image-s3',
          thumbnailPath: 'thumbnails/file-image-s3.jpg',
        }),
      );

      await service.uploadFile(imageFile, createDto, mockUser);

      expect(thumbnailService.generateImageThumbnail).toHaveBeenCalledWith(
        '/tmp/photo-123.png',
        'file-image-s3',
        StorageType.S3,
        'image/png',
        null,
      );
      expect(storageService.deleteFile).toHaveBeenCalledWith(
        '/tmp/photo-123.png',
      );
    });
  });

  describe('filename sanitization', () => {
    const createDto = {
      resourceType: ResourceType.MESSAGE_ATTACHMENT,
      resourceId: 'msg-123',
    };

    beforeEach(() => {
      databaseService.file.create.mockResolvedValue({ id: 'file-123' } as any);

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));
    });

    const getStoredData = () =>
      databaseService.file.create.mock.calls[0][0].data as {
        filename: string;
        storagePath: string;
      };

    it('should strip path separators from the client-supplied filename', async () => {
      const file = {
        ...mockFile,
        originalname: '../../etc/passwd',
      };

      await service.uploadFile(file, createDto, mockUser);

      const data = getStoredData();
      expect(data.filename).not.toContain('/');
      expect(data.filename).not.toContain('\\');
      expect(data.filename).toBe('.._.._etc_passwd');
    });

    it('should strip Windows path separators and control characters', async () => {
      const file = {
        ...mockFile,
        originalname: '..\\..\\evil\tna me.png',
      };

      await service.uploadFile(file, createDto, mockUser);

      const data = getStoredData();
      expect(data.filename).toBe('.._.._evilna me.png');
    });

    it('should cap stored filename at 255 characters', async () => {
      const file = {
        ...mockFile,
        originalname: 'a'.repeat(300) + '.png',
      };

      await service.uploadFile(file, createDto, mockUser);

      expect(getStoredData().filename).toHaveLength(255);
    });

    it('should fall back to a placeholder when the name is empty after sanitization', async () => {
      const file = {
        ...mockFile,
        originalname: ' ',
      };

      await service.uploadFile(file, createDto, mockUser);

      expect(getStoredData().filename).toBe('file');
    });

    it('should never use the client-supplied name for the storage path', async () => {
      const file = {
        ...mockFile,
        originalname: '../../etc/passwd',
      };

      await service.uploadFile(file, createDto, mockUser);

      const data = getStoredData();
      // storagePath comes from multer's server-generated path, untouched by
      // the original name
      expect(data.storagePath).toBe('/tmp/test-123.png');
      expect(data.storagePath).not.toContain('passwd');
    });
  });

  describe('remove', () => {
    const userId = 'user-123';

    it('should soft delete a file owned by the user', async () => {
      const fileId = 'file-123';
      const deletedFile = { id: fileId, deletedAt: new Date() };

      databaseService.file.findUnique.mockResolvedValue({
        uploadedById: userId,
        size: 2048,
      } as any);
      databaseService.file.update.mockResolvedValue(deletedFile as any);

      const result = await service.remove(fileId, userId);

      expect(result).toMatchObject(deletedFile);
      expect(result.hasThumbnail).toBe(false);
      expect(databaseService.file.update).toHaveBeenCalledWith({
        where: { id: fileId },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should throw NotFoundException if file does not exist', async () => {
      databaseService.file.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent', userId)).rejects.toThrow(
        'File not found',
      );
    });

    it('should throw ForbiddenException if user does not own the file', async () => {
      databaseService.file.findUnique.mockResolvedValue({
        uploadedById: 'other-user',
        size: 2048,
        deletedAt: null,
      } as any);

      await expect(service.remove('file-123', userId)).rejects.toThrow(
        'You can only delete your own files',
      );
    });

    it('should throw NotFoundException if file is already soft-deleted', async () => {
      databaseService.file.findUnique.mockResolvedValue({
        uploadedById: userId,
        size: 2048,
        deletedAt: new Date(),
      } as any);

      await expect(service.remove('file-123', userId)).rejects.toThrow(
        'File not found',
      );
      expect(databaseService.file.update).not.toHaveBeenCalled();
      expect(storageQuotaService.decrementUserStorage).not.toHaveBeenCalled();
    });

    it('should decrement storage quota after soft deleting a file', async () => {
      const fileId = 'file-456';
      const fileSize = 5120;

      databaseService.file.findUnique.mockResolvedValue({
        uploadedById: userId,
        size: fileSize,
      } as any);
      databaseService.file.update.mockResolvedValue({
        id: fileId,
        deletedAt: new Date(),
      } as any);
      storageQuotaService.decrementUserStorage.mockResolvedValue(undefined);

      await service.remove(fileId, userId);

      expect(storageQuotaService.decrementUserStorage).toHaveBeenCalledWith(
        userId,
        fileSize,
      );
    });

    it('should not decrement storage quota if file has no size', async () => {
      const fileId = 'file-789';

      databaseService.file.findUnique.mockResolvedValue({
        uploadedById: userId,
        size: 0,
      } as any);
      databaseService.file.update.mockResolvedValue({
        id: fileId,
        deletedAt: new Date(),
      } as any);

      await service.remove(fileId, userId);

      expect(storageQuotaService.decrementUserStorage).not.toHaveBeenCalled();
    });

    it('should handle multiple file removals', async () => {
      const fileIds = ['file-1', 'file-2', 'file-3'];

      for (const fileId of fileIds) {
        databaseService.file.findUnique.mockResolvedValue({
          uploadedById: userId,
          size: 1024,
        } as any);
        databaseService.file.update.mockResolvedValue({
          id: fileId,
          deletedAt: new Date(),
        } as any);

        await service.remove(fileId, userId);

        expect(databaseService.file.update).toHaveBeenCalledWith({
          where: { id: fileId },
          data: { deletedAt: expect.any(Date) },
        });
      }
    });
  });

  describe('resourceId', () => {
    const reject = (dto: Record<string, unknown>, user: any = mockUser) =>
      expect(service.uploadFile(mockFile, dto as any, user)).rejects.toThrow(
        ForbiddenException,
      );

    afterEach(() => {
      expect(storageQuotaService.reserveStorage).not.toHaveBeenCalled();
      expect(storageService.deleteFile).toHaveBeenCalledWith(mockFile.path);
    });

    it("rejects someone else's message, or none at all", async () => {
      (databaseService.message.findUnique as jest.Mock)
        .mockResolvedValueOnce({ authorId: 'other' })
        .mockResolvedValueOnce(null);
      const dto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-1',
      };
      await reject(dto);
      await reject(dto);
    });

    it.each([ResourceType.USER_AVATAR, ResourceType.USER_BANNER])(
      'rejects %s for another user',
      async (resourceType) => {
        await reject({ resourceType, resourceId: 'other' });
      },
    );

    it.each([
      [ResourceType.COMMUNITY_AVATAR, 'UPDATE_COMMUNITY'],
      [ResourceType.COMMUNITY_BANNER, 'UPDATE_COMMUNITY'],
      [ResourceType.CUSTOM_EMOJI, 'MANAGE_EMOJIS'],
      [ResourceType.SOUNDBOARD_SOUND, 'CREATE_SOUNDBOARD_SOUND'],
    ])('%s needs %s in the community', async (resourceType, action) => {
      permissionsService.verifyActionsForUserAndResource.mockResolvedValue(
        false,
      );
      await reject({ resourceType, resourceId: 'community-1' });
      expect(
        permissionsService.verifyActionsForUserAndResource,
      ).toHaveBeenCalledWith(mockUser.id, 'community-1', 'COMMUNITY', [action]);
    });
  });
});
