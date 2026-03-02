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

jest.mock('./validators/resource-type-file.validator');

describe('FileUploadService', () => {
  let service: FileUploadService;
  let databaseService: Mocked<DatabaseService>;
  let storageService: Mocked<StorageService>;
  let storageQuotaService: Mocked<StorageQuotaService>;
  let thumbnailService: Mocked<ThumbnailService>;

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

    // Default mock implementations - use StorageService instead of direct fs calls
    storageService.readFile.mockResolvedValue(Buffer.from('test'));
    storageService.deleteFile.mockResolvedValue(undefined);

    // Default quota check passes
    storageQuotaService.canUploadFile.mockResolvedValue({
      canUpload: true,
      currentUsedBytes: 0,
      quotaBytes: 1000000000,
      requestedBytes: 1024,
      remainingBytes: 999998976,
    } as any);
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

      expect(storageService.readFile).toHaveBeenCalledWith('/tmp/test-123.png');
      expect(crypto.createHash).toHaveBeenCalledWith('sha256');
      expect(databaseService.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          checksum: 'abc123def456',
        }),
      });
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
