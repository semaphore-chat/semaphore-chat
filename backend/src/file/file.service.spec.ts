import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { FileService } from './file.service';
import { DatabaseService } from '@/database/database.service';
import { StorageService } from '@/storage/storage.service';

describe('FileService', () => {
  let service: FileService;
  let databaseService: Mocked<DatabaseService>;
  let storageService: Mocked<StorageService>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(FileService).compile();

    service = unit;
    databaseService = unitRef.get(DatabaseService);
    storageService = unitRef.get(StorageService);

    // Reset mocks
    jest.clearAllMocks();

    // Default mock for deleteFile
    storageService.deleteFile.mockResolvedValue(undefined);
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

  describe('findOne', () => {
    it('should find a file by id', async () => {
      const fileId = 'file-123';
      const mockFile = {
        id: fileId,
        filename: 'test.png',
        mimeType: 'image/png',
        size: 1024,
      };

      databaseService.file.findUniqueOrThrow.mockResolvedValue(mockFile as any);

      const result = await service.findOne(fileId);

      expect(result).toEqual(mockFile);
      expect(databaseService.file.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: fileId, deletedAt: null },
      });
    });

    it('should throw error if file not found', async () => {
      const fileId = 'non-existent';

      databaseService.file.findUniqueOrThrow.mockRejectedValue(
        new Error('File not found'),
      );

      await expect(service.findOne(fileId)).rejects.toThrow('File not found');
    });
  });

  describe('markForDeletion', () => {
    it('should mark a file for deletion', async () => {
      const fileId = 'file-456';

      databaseService.file.update.mockResolvedValue({
        id: fileId,
        deletedAt: new Date(),
      } as any);

      await service.markForDeletion(fileId);

      expect(databaseService.file.update).toHaveBeenCalledWith({
        where: { id: fileId },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should not throw error if file update fails', async () => {
      const fileId = 'file-789';

      databaseService.file.update.mockRejectedValue(
        new Error('File not found'),
      );

      // Should not throw - just logs warning
      await expect(service.markForDeletion(fileId)).resolves.toBeUndefined();
    });

    it('should use transaction client when provided', async () => {
      const fileId = 'file-tx';
      const mockTxClient = {
        file: {
          update: jest.fn().mockResolvedValue({
            id: fileId,
            deletedAt: new Date(),
          }),
        },
      };

      await service.markForDeletion(fileId, mockTxClient as any);

      // Should use tx client instead of databaseService
      expect(mockTxClient.file.update).toHaveBeenCalledWith({
        where: { id: fileId },
        data: { deletedAt: expect.any(Date) },
      });
      expect(databaseService.file.update).not.toHaveBeenCalled();
    });

    it('should handle multiple mark for deletion calls', async () => {
      const fileIds = ['file-1', 'file-2', 'file-3'];

      for (const fileId of fileIds) {
        databaseService.file.update.mockResolvedValue({
          id: fileId,
          deletedAt: new Date(),
        } as any);

        await service.markForDeletion(fileId);

        expect(databaseService.file.update).toHaveBeenCalledWith({
          where: { id: fileId },
          data: { deletedAt: expect.any(Date) },
        });
      }
    });
  });

  describe('cleanupOldFiles', () => {
    it('should cleanup deleted files from local storage', async () => {
      const deletedFiles = [
        {
          id: 'file-1',
          storageType: 'LOCAL',
          storagePath: '/tmp/file1.png',
          deletedAt: new Date(),
        },
        {
          id: 'file-2',
          storageType: 'LOCAL',
          storagePath: '/tmp/file2.png',
          deletedAt: new Date(),
        },
      ];

      databaseService.file.findMany.mockResolvedValue(deletedFiles as any);
      databaseService.file.delete.mockResolvedValue({ id: 'file-1' } as any);

      await service.cleanupOldFiles();

      expect(databaseService.file.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: { not: null },
        },
      });

      expect(storageService.deleteFile).toHaveBeenCalledWith('/tmp/file1.png');
      expect(storageService.deleteFile).toHaveBeenCalledWith('/tmp/file2.png');
      expect(storageService.deleteFile).toHaveBeenCalledTimes(2);

      expect(databaseService.file.delete).toHaveBeenCalledWith({
        where: { id: 'file-1' },
      });
      expect(databaseService.file.delete).toHaveBeenCalledWith({
        where: { id: 'file-2' },
      });
    });

    it('should skip non-LOCAL storage files', async () => {
      const deletedFiles = [
        {
          id: 'file-s3',
          storageType: 'S3',
          storagePath: 's3://bucket/file.png',
          deletedAt: new Date(),
        },
      ];

      databaseService.file.findMany.mockResolvedValue(deletedFiles as any);

      await service.cleanupOldFiles();

      expect(storageService.deleteFile).not.toHaveBeenCalled();
      expect(databaseService.file.delete).not.toHaveBeenCalled();
    });

    it('should skip files without storage path', async () => {
      const deletedFiles = [
        {
          id: 'file-no-path',
          storageType: 'LOCAL',
          storagePath: null,
          deletedAt: new Date(),
        },
      ];

      databaseService.file.findMany.mockResolvedValue(deletedFiles as any);

      await service.cleanupOldFiles();

      expect(storageService.deleteFile).not.toHaveBeenCalled();
      expect(databaseService.file.delete).not.toHaveBeenCalled();
    });

    it('should continue on error and process remaining files', async () => {
      const deletedFiles = [
        {
          id: 'file-error',
          storageType: 'LOCAL',
          storagePath: '/tmp/error.png',
          deletedAt: new Date(),
        },
        {
          id: 'file-success',
          storageType: 'LOCAL',
          storagePath: '/tmp/success.png',
          deletedAt: new Date(),
        },
      ];

      databaseService.file.findMany.mockResolvedValue(deletedFiles as any);
      storageService.deleteFile
        .mockRejectedValueOnce(new Error('File not found'))
        .mockResolvedValueOnce(undefined);

      await service.cleanupOldFiles();

      // Should have attempted both files
      expect(storageService.deleteFile).toHaveBeenCalledWith('/tmp/error.png');
      expect(storageService.deleteFile).toHaveBeenCalledWith(
        '/tmp/success.png',
      );

      // Only successful file should be deleted from DB
      expect(databaseService.file.delete).toHaveBeenCalledTimes(1);
      expect(databaseService.file.delete).toHaveBeenCalledWith({
        where: { id: 'file-success' },
      });
    });

    it('should handle empty deleted files list', async () => {
      databaseService.file.findMany.mockResolvedValue([]);

      await service.cleanupOldFiles();

      expect(storageService.deleteFile).not.toHaveBeenCalled();
      expect(databaseService.file.delete).not.toHaveBeenCalled();
    });

    it('should continue if database delete fails', async () => {
      const deletedFiles = [
        {
          id: 'file-db-error',
          storageType: 'LOCAL',
          storagePath: '/tmp/file.png',
          deletedAt: new Date(),
        },
      ];

      databaseService.file.findMany.mockResolvedValue(deletedFiles as any);
      databaseService.file.delete.mockRejectedValue(
        new Error('DB delete failed'),
      );

      // Should not throw - just logs error
      await expect(service.cleanupOldFiles()).resolves.toBeUndefined();

      expect(storageService.deleteFile).toHaveBeenCalledWith('/tmp/file.png');
    });
  });
});
