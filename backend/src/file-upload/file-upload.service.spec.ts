/* eslint-disable @typescript-eslint/no-require-imports */
import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { FileUploadService } from './file-upload.service';
import { DatabaseService } from '@/database/database.service';
import { StorageService } from '@/storage/storage.service';
import { StorageQuotaService } from '@/storage-quota/storage-quota.service';
import { ThumbnailService } from '@/file/thumbnail.service';
import { UnprocessableEntityException } from '@nestjs/common';
import { ResourceType, FileType, StorageType } from '@prisma/client';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import type { IStorageProvider } from '@/storage/interfaces/storage-provider.interface';
import { FileUploadResponseDto } from './dto/file-upload-response.dto';

jest.mock('./validators/resource-type-file.validator');

describe('FileUploadService', () => {
  let service: FileUploadService;
  let databaseService: Mocked<DatabaseService>;
  let storageService: Mocked<StorageService>;
  let storageQuotaService: Mocked<StorageQuotaService>;
  let thumbnailService: Mocked<ThumbnailService>;
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

    // Reset mocks
    jest.clearAllMocks();

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

    // Default quota check passes
    storageQuotaService.canUploadFile.mockResolvedValue({
      canUpload: true,
      currentUsedBytes: 0,
      quotaBytes: 1000000000,
      requestedBytes: 1024,
      remainingBytes: 999998976,
    });
    storageQuotaService.incrementUserStorage.mockResolvedValue(undefined);

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

      expect(result).toEqual(createdFile);
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

      it('should not generate thumbnails for non-video files', async () => {
        databaseService.file.create.mockResolvedValue({
          id: 'file-img-1',
          fileType: FileType.IMAGE,
        } as any);

        await service.uploadFile(mockFile, createDto, mockUser);

        expect(thumbnailService.generateVideoThumbnail).not.toHaveBeenCalled();
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

    it('should not generate thumbnail for image uploads', async () => {
      const createDto = {
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
        resourceId: 'msg-123',
      };

      databaseService.file.create.mockResolvedValue({
        id: 'file-img-1',
      } as any);

      const {
        ResourceTypeFileValidator,
      } = require('./validators/resource-type-file.validator');
      ResourceTypeFileValidator.mockImplementation(() => ({
        isValid: jest.fn().mockResolvedValue(true),
      }));

      await service.uploadFile(mockFile, createDto, mockUser);

      expect(thumbnailService.generateVideoThumbnail).not.toHaveBeenCalled();
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

      expect(result).toEqual(deletedFile);
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
});
