import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { SignedUrlService } from './signed-url.service';
import { StorageService } from '@/storage/storage.service';
import { NotFoundException } from '@nestjs/common';
import { StorageType, FileType } from '@prisma/client';
import { Request, Response } from 'express';
import { Readable } from 'stream';
import type { IStorageProvider } from '@/storage/interfaces/storage-provider.interface';
import { AuthenticatedRequest } from '@/types';

describe('FileController', () => {
  let controller: FileController;
  let service: Mocked<FileService>;
  let signedUrlService: Mocked<SignedUrlService>;
  let storageService: Mocked<StorageService>;
  let mockProvider: jest.Mocked<IStorageProvider>;

  const mockResponse = {
    set: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as Response;

  const mockRequest = (rangeHeader?: string): Request =>
    ({
      headers: rangeHeader ? { range: rangeHeader } : {},
    }) as unknown as Request;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(FileController).compile();

    controller = unit;
    service = unitRef.get(FileService);
    signedUrlService = unitRef.get(SignedUrlService);
    storageService = unitRef.get(StorageService);

    // Reset mocks
    jest.clearAllMocks();

    // Per-record provider resolution: the controller always resolves via
    // storageService.getProvider(file.storageType) and reads through the
    // returned provider — never a direct fs call.
    mockProvider = {
      writeStream: jest.fn(),
      getReadStream: jest
        .fn()
        .mockResolvedValue(Readable.from([Buffer.from('data')])),
      deleteFile: jest.fn(),
      fileExists: jest.fn(),
      getFileStats: jest.fn(),
      getFileUrl: jest.fn(),
    };
    storageService.getProvider.mockReturnValue(mockProvider);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should have a service', () => {
    expect(service).toBeDefined();
  });

  describe('getFileMetadata', () => {
    it('should return file metadata with hasThumbnail false', async () => {
      const fileId = 'file-123';
      const mockFile = {
        id: fileId,
        filename: 'test.png',
        mimeType: 'image/png',
        fileType: FileType.IMAGE,
        size: 1024,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/test.png',
        thumbnailPath: null,
      };

      service.findOne.mockResolvedValue(mockFile as any);

      const result = await controller.getFileMetadata(fileId);

      expect(result).toEqual({
        id: fileId,
        filename: 'test.png',
        mimeType: 'image/png',
        fileType: FileType.IMAGE,
        size: 1024,
        hasThumbnail: false,
        width: null,
        height: null,
      });
      expect(service.findOne).toHaveBeenCalledWith(fileId);
    });

    it('should return the stored width and height', async () => {
      const fileId = 'file-image';
      service.findOne.mockResolvedValue({
        id: fileId,
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        fileType: FileType.IMAGE,
        size: 2048,
        width: 1080,
        height: 1920,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/photo.jpg',
        thumbnailPath: null,
      } as any);

      const result = await controller.getFileMetadata(fileId);

      expect(result).toMatchObject({ width: 1080, height: 1920 });
    });

    it('should return hasThumbnail true when thumbnailPath exists', async () => {
      const fileId = 'file-video';
      const mockFile = {
        id: fileId,
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        fileType: FileType.VIDEO,
        size: 50000,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/video.mp4',
        thumbnailPath: '/uploads/thumbnails/file-video.jpg',
      };

      service.findOne.mockResolvedValue(mockFile as any);

      const result = await controller.getFileMetadata(fileId);

      expect(result.hasThumbnail).toBe(true);
    });

    it('should throw NotFoundException if file not found', async () => {
      service.findOne.mockResolvedValue(null as any);

      await expect(controller.getFileMetadata('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should propagate service errors', async () => {
      service.findOne.mockRejectedValue(new Error('Database error'));

      await expect(controller.getFileMetadata('error-file')).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('getFileThumbnail', () => {
    it('should stream thumbnail JPEG when available, via the LOCAL provider', async () => {
      const fileId = 'file-video';
      const mockFile = {
        id: fileId,
        thumbnailPath: '/uploads/thumbnails/file-video.jpg',
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/video.mp4',
      };

      service.findOne.mockResolvedValue(mockFile as any);

      const result = await controller.getFileThumbnail(fileId, mockResponse);

      expect(storageService.getProvider).toHaveBeenCalledWith(
        StorageType.LOCAL,
      );
      expect(mockProvider.getReadStream).toHaveBeenCalledWith(
        '/uploads/thumbnails/file-video.jpg',
      );
      expect(mockResponse.set).toHaveBeenCalledWith({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=86400',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      expect(result).toBeDefined();
    });

    it('should stream an S3-backed thumbnail via the S3 provider (per-record resolution)', async () => {
      const fileId = 'file-video-s3';
      const mockFile = {
        id: fileId,
        thumbnailPath: 'thumbnails/file-video-s3.jpg',
        storageType: StorageType.S3,
        storagePath: 'video-key',
      };

      service.findOne.mockResolvedValue(mockFile as any);

      await controller.getFileThumbnail(fileId, mockResponse);

      expect(storageService.getProvider).toHaveBeenCalledWith(StorageType.S3);
      expect(mockProvider.getReadStream).toHaveBeenCalledWith(
        'thumbnails/file-video-s3.jpg',
      );
    });

    it('should throw NotFoundException when no thumbnailPath', async () => {
      const mockFile = {
        id: 'file-no-thumb',
        thumbnailPath: null,
      };

      service.findOne.mockResolvedValue(mockFile as any);

      await expect(
        controller.getFileThumbnail('file-no-thumb', mockResponse),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when file not found', async () => {
      service.findOne.mockResolvedValue(null as any);

      await expect(
        controller.getFileThumbnail('missing', mockResponse),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFile', () => {
    it('should return file stream for local storage via the LOCAL provider', async () => {
      const fileId = 'file-456';
      const mockFile = {
        id: fileId,
        filename: 'download.pdf',
        mimeType: 'application/pdf',
        fileType: FileType.DOCUMENT,
        size: 4096,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/download.pdf',
      };

      service.findOne.mockResolvedValue(mockFile as any);
      const req = mockRequest();

      const result = await controller.getFile(fileId, req, mockResponse);

      expect(service.findOne).toHaveBeenCalledWith(fileId);
      expect(storageService.getProvider).toHaveBeenCalledWith(
        StorageType.LOCAL,
      );
      expect(mockProvider.getReadStream).toHaveBeenCalledWith(
        '/tmp/download.pdf',
      );
      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Accept-Ranges': 'bytes',
        }),
      );
      expect(result).toBeDefined();
    });

    it('should return file stream for S3 storage via the S3 provider (per-record resolution)', async () => {
      const mockFile = {
        id: 'file-s3',
        filename: 'remote.png',
        mimeType: 'image/png',
        fileType: FileType.IMAGE,
        size: 1024,
        storageType: StorageType.S3,
        storagePath: 'remote-object-key',
      };

      service.findOne.mockResolvedValue(mockFile as any);

      const result = await controller.getFile(
        'file-s3',
        mockRequest(),
        mockResponse,
      );

      expect(storageService.getProvider).toHaveBeenCalledWith(StorageType.S3);
      expect(mockProvider.getReadStream).toHaveBeenCalledWith(
        'remote-object-key',
      );
      expect(result).toBeDefined();
    });

    it('should include Content-Length for full file responses', async () => {
      const mockFile = {
        id: 'file-123',
        filename: 'test.txt',
        mimeType: 'text/plain',
        fileType: FileType.DOCUMENT,
        size: 1024,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/test.txt',
      };

      service.findOne.mockResolvedValue(mockFile as any);

      await controller.getFile('file-123', mockRequest(), mockResponse);

      // Check that Content-Length is set (second set call)
      const setCalls = (mockResponse.set as jest.Mock).mock.calls;
      const allHeaders = setCalls.reduce(
        (acc: Record<string, unknown>, call: unknown[]) =>
          Object.assign(acc, call[0]),
        {},
      );
      expect(allHeaders['Content-Length']).toBe(1024); // From file.size
    });

    it('should handle Range requests with 206 Partial Content', async () => {
      const mockFile = {
        id: 'file-range',
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        fileType: FileType.VIDEO,
        size: 10000,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/video.mp4',
      };

      service.findOne.mockResolvedValue(mockFile as any);
      const req = mockRequest('bytes=0-999');

      await controller.getFile('file-range', req, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(206);
      expect(mockProvider.getReadStream).toHaveBeenCalledWith(
        '/tmp/video.mp4',
        {
          start: 0,
          end: 999,
        },
      );

      const setCalls = (mockResponse.set as jest.Mock).mock.calls;
      const allHeaders = setCalls.reduce(
        (acc: Record<string, unknown>, call: unknown[]) =>
          Object.assign(acc, call[0]),
        {},
      );
      expect(allHeaders['Content-Range']).toBe('bytes 0-999/10000');
      expect(allHeaders['Content-Length']).toBe(1000);
    });

    it('should handle Range requests without end byte', async () => {
      const mockFile = {
        id: 'file-range-open',
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        fileType: FileType.VIDEO,
        size: 10000,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/video.mp4',
      };

      service.findOne.mockResolvedValue(mockFile as any);
      const req = mockRequest('bytes=5000-');

      await controller.getFile('file-range-open', req, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(206);
      expect(mockProvider.getReadStream).toHaveBeenCalledWith(
        '/tmp/video.mp4',
        {
          start: 5000,
          end: 9999,
        },
      );
    });

    it('should return 416 for out-of-range requests', async () => {
      const mockFile = {
        id: 'file-bad-range',
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        fileType: FileType.VIDEO,
        size: 10000,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/video.mp4',
      };

      service.findOne.mockResolvedValue(mockFile as any);
      const req = mockRequest('bytes=20000-30000');

      await controller.getFile('file-bad-range', req, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(416);
    });

    it('should clamp end to file boundary when Range end exceeds file size', async () => {
      const mockFile = {
        id: 'file-clamp',
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        fileType: FileType.VIDEO,
        size: 10000,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/video.mp4',
      };

      service.findOne.mockResolvedValue(mockFile as any);
      const req = mockRequest('bytes=0-999999');

      await controller.getFile('file-clamp', req, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(206);
      expect(mockProvider.getReadStream).toHaveBeenCalledWith(
        '/tmp/video.mp4',
        {
          start: 0,
          end: 9999,
        },
      );

      const setCalls = (mockResponse.set as jest.Mock).mock.calls;
      const allHeaders = setCalls.reduce(
        (acc: Record<string, unknown>, call: unknown[]) =>
          Object.assign(acc, call[0]),
        {},
      );
      expect(allHeaders['Content-Range']).toBe('bytes 0-9999/10000');
      expect(allHeaders['Content-Length']).toBe(10000);
    });

    it('should handle single-byte Range request', async () => {
      const mockFile = {
        id: 'file-1byte',
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        fileType: FileType.VIDEO,
        size: 10000,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/video.mp4',
      };

      service.findOne.mockResolvedValue(mockFile as any);
      const req = mockRequest('bytes=100-100');

      await controller.getFile('file-1byte', req, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(206);
      expect(mockProvider.getReadStream).toHaveBeenCalledWith(
        '/tmp/video.mp4',
        {
          start: 100,
          end: 100,
        },
      );

      const setCalls = (mockResponse.set as jest.Mock).mock.calls;
      const allHeaders = setCalls.reduce(
        (acc: Record<string, unknown>, call: unknown[]) =>
          Object.assign(acc, call[0]),
        {},
      );
      expect(allHeaders['Content-Length']).toBe(1);
    });

    it('should fall through to full file when Range header is malformed', async () => {
      const mockFile = {
        id: 'file-malformed',
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        fileType: FileType.VIDEO,
        size: 10000,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/video.mp4',
      };

      service.findOne.mockResolvedValue(mockFile as any);
      // Malformed: no digits match /bytes=(\d+)-(\d*)/
      const req = mockRequest('bytes=abc-def');

      await controller.getFile('file-malformed', req, mockResponse);

      // Should serve full file (no 206, no Content-Range)
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(mockProvider.getReadStream).toHaveBeenCalledWith('/tmp/video.mp4');
    });

    it('should return 416 when start > end in Range', async () => {
      const mockFile = {
        id: 'file-reversed',
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        fileType: FileType.VIDEO,
        size: 10000,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/video.mp4',
      };

      service.findOne.mockResolvedValue(mockFile as any);
      const req = mockRequest('bytes=500-100');

      await controller.getFile('file-reversed', req, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(416);
    });

    it('should set Accept-Ranges header on all responses', async () => {
      const mockFile = {
        id: 'file-accept',
        filename: 'test.txt',
        mimeType: 'text/plain',
        fileType: FileType.DOCUMENT,
        size: 1024,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/test.txt',
      };

      service.findOne.mockResolvedValue(mockFile as any);

      await controller.getFile('file-accept', mockRequest(), mockResponse);

      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Accept-Ranges': 'bytes',
        }),
      );
    });

    it('should support Range requests for S3-backed files too', async () => {
      const mockFile = {
        id: 'file-s3-range',
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        fileType: FileType.VIDEO,
        size: 10000,
        storageType: StorageType.S3,
        storagePath: 's3-video-key',
      };

      service.findOne.mockResolvedValue(mockFile as any);
      const req = mockRequest('bytes=0-999');

      await controller.getFile('file-s3-range', req, mockResponse);

      expect(storageService.getProvider).toHaveBeenCalledWith(StorageType.S3);
      expect(mockResponse.status).toHaveBeenCalledWith(206);
      expect(mockProvider.getReadStream).toHaveBeenCalledWith('s3-video-key', {
        start: 0,
        end: 999,
      });
    });

    it('should throw NotFoundException if file not found', async () => {
      service.findOne.mockResolvedValue(null as any);

      await expect(
        controller.getFile('missing-file', mockRequest(), mockResponse),
      ).rejects.toThrow(NotFoundException);
    });

    it('should force attachment disposition for SVG files', async () => {
      const mockFile = {
        id: 'file-svg',
        filename: 'image.svg',
        mimeType: 'image/svg+xml',
        fileType: FileType.IMAGE,
        size: 2048,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/image.svg',
      };

      service.findOne.mockResolvedValue(mockFile as any);

      await controller.getFile('file-svg', mockRequest(), mockResponse);

      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Disposition': expect.stringMatching(/^attachment;/),
        }),
      );
    });

    it('should force attachment disposition for HTML files', async () => {
      const mockFile = {
        id: 'file-html',
        filename: 'page.html',
        mimeType: 'text/html',
        fileType: FileType.DOCUMENT,
        size: 512,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/page.html',
      };

      service.findOne.mockResolvedValue(mockFile as any);

      await controller.getFile('file-html', mockRequest(), mockResponse);

      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Disposition': expect.stringMatching(/^attachment;/),
        }),
      );
    });

    it('should use inline disposition for safe MIME types', async () => {
      const mockFile = {
        id: 'file-png',
        filename: 'photo.png',
        mimeType: 'image/png',
        fileType: FileType.IMAGE,
        size: 4096,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/photo.png',
      };

      service.findOne.mockResolvedValue(mockFile as any);

      await controller.getFile('file-png', mockRequest(), mockResponse);

      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Disposition': expect.stringMatching(/^inline;/),
        }),
      );
    });

    it('should handle filenames with special characters', async () => {
      const mockFile = {
        id: 'file-special',
        filename: 'my "special" file.pdf',
        mimeType: 'application/pdf',
        fileType: FileType.DOCUMENT,
        size: 2048,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/special.pdf',
      };

      service.findOne.mockResolvedValue(mockFile as any);

      await controller.getFile('file-special', mockRequest(), mockResponse);

      expect(mockResponse.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Disposition': `inline; filename="my _special_ file.pdf"; filename*=UTF-8''my%20%22special%22%20file.pdf`,
        }),
      );
    });
  });

  describe('getSignedUrl', () => {
    const mockAuthRequest = (userId: string) =>
      ({
        user: { id: userId },
      }) as unknown as AuthenticatedRequest;

    it('should return a signed URL and expiry for a valid file', async () => {
      const fileId = 'file-signed';
      const mockFile = {
        id: fileId,
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        fileType: FileType.VIDEO,
        size: 10000,
        storageType: StorageType.LOCAL,
        storagePath: '/tmp/video.mp4',
      };

      const expiresAt = new Date(Date.now() + 3600 * 1000);
      service.findOne.mockResolvedValue(mockFile as any);
      signedUrlService.generateSignedUrl.mockReturnValue({
        url: `/api/file/${fileId}?sig=abc&exp=123&uid=user-1`,
        expiresAt,
      });

      const result = await controller.getSignedUrl(
        fileId,
        mockAuthRequest('user-1'),
      );

      expect(result).toEqual({
        url: `/api/file/${fileId}?sig=abc&exp=123&uid=user-1`,
        expiresAt: expiresAt.toISOString(),
      });
      expect(signedUrlService.generateSignedUrl).toHaveBeenCalledWith(
        `/api/file/${fileId}`,
        fileId,
        'user-1',
      );
    });

    it('should throw NotFoundException when file does not exist', async () => {
      service.findOne.mockResolvedValue(null as any);

      await expect(
        controller.getSignedUrl('non-existent', mockAuthRequest('user-1')),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate service errors', async () => {
      service.findOne.mockRejectedValue(new Error('Database error'));

      await expect(
        controller.getSignedUrl('error-file', mockAuthRequest('user-1')),
      ).rejects.toThrow('Database error');
    });
  });
});
