import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClipLibraryService } from './clip-library.service';
import { DatabaseService } from '@/database/database.service';
import { StorageService } from '@/storage/storage.service';
import { NotFoundException } from '@nestjs/common';
import { CLIP_MESSAGE_CREATE } from '@/common/events/clip-message.events';

describe('ClipLibraryService', () => {
  let service: ClipLibraryService;

  const mockDatabaseService = {
    replayClip: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    file: {
      delete: jest.fn(),
    },
    channel: {
      findUnique: jest.fn(),
    },
    membership: {
      findFirst: jest.fn(),
    },
    directMessageGroupMember: {
      findFirst: jest.fn(),
    },
    channelMembership: {
      findFirst: jest.fn(),
    },
  };

  let storageService: Mocked<StorageService>;
  let eventEmitter: Mocked<EventEmitter2>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(ClipLibraryService)
      .mock(DatabaseService)
      .final(mockDatabaseService)
      .compile();

    service = unit;
    storageService = unitRef.get(StorageService);
    eventEmitter = unitRef.get(EventEmitter2);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('getUserClips', () => {
    it('should return user clips with formatted data', async () => {
      const clips = [
        {
          id: 'clip-1',
          fileId: 'file-1',
          channelId: 'channel-1',
          durationSeconds: 60,
          isPublic: false,
          capturedAt: new Date('2025-01-01'),
          file: {
            id: 'file-1',
            filename: 'clip.mp4',
            size: 1000000,
          },
        },
      ];

      mockDatabaseService.replayClip.findMany.mockResolvedValue(clips);

      const result = await service.getUserClips('user-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('clip-1');
      expect(result[0].fileId).toBe('file-1');
      expect(result[0].channelId).toBe('channel-1');
      expect(result[0].durationSeconds).toBe(60);
      expect(result[0].isPublic).toBe(false);
      expect(result[0].downloadUrl).toBe('/file/file-1');
      expect(result[0].sizeBytes).toBe(1000000);
      expect(result[0].filename).toBe('clip.mp4');
    });

    it('should return empty array when user has no clips', async () => {
      mockDatabaseService.replayClip.findMany.mockResolvedValue([]);

      const result = await service.getUserClips('user-123');

      expect(result).toEqual([]);
    });
  });

  describe('getPublicClips', () => {
    it('should return only public clips for a user', async () => {
      const clips = [
        {
          id: 'clip-1',
          fileId: 'file-1',
          channelId: 'channel-1',
          durationSeconds: 60,
          isPublic: true,
          capturedAt: new Date('2025-01-01'),
          file: {
            id: 'file-1',
            filename: 'clip.mp4',
            size: 1000000,
          },
        },
      ];

      mockDatabaseService.replayClip.findMany.mockResolvedValue(clips);

      const result = await service.getPublicClips('user-123');

      expect(result).toHaveLength(1);
      expect(result[0].isPublic).toBe(true);
      expect(mockDatabaseService.replayClip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-123',
            isPublic: true,
          },
        }),
      );
    });
  });

  describe('updateClip', () => {
    it('should update clip isPublic status', async () => {
      const clip = {
        id: 'clip-1',
        userId: 'user-123',
        fileId: 'file-1',
        channelId: 'channel-1',
        durationSeconds: 60,
        isPublic: false,
        capturedAt: new Date('2025-01-01'),
        file: {
          id: 'file-1',
          filename: 'clip.mp4',
          size: 1000000,
        },
      };

      const updatedClip = {
        ...clip,
        isPublic: true,
      };

      mockDatabaseService.replayClip.findFirst.mockResolvedValue(clip);
      mockDatabaseService.replayClip.update.mockResolvedValue(updatedClip);

      const result = await service.updateClip('user-123', 'clip-1', {
        isPublic: true,
      });

      expect(result.isPublic).toBe(true);
      expect(mockDatabaseService.replayClip.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'clip-1' },
          data: expect.objectContaining({
            isPublic: true,
          }),
        }),
      );
    });

    it('should throw NotFoundException when clip not found', async () => {
      mockDatabaseService.replayClip.findFirst.mockResolvedValue(null);

      await expect(
        service.updateClip('user-123', 'nonexistent', { isPublic: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteClip', () => {
    it('should delete clip and associated file', async () => {
      const clip = {
        id: 'clip-1',
        userId: 'user-123',
        fileId: 'file-1',
        file: {
          id: 'file-1',
          storagePath: '/uploads/replays/user-123/clip.mp4',
        },
      };

      mockDatabaseService.replayClip.findFirst.mockResolvedValue(clip);
      mockDatabaseService.replayClip.delete.mockResolvedValue(clip);
      mockDatabaseService.file.delete.mockResolvedValue(clip.file);
      storageService.deleteFile.mockResolvedValue(undefined);

      await service.deleteClip('user-123', 'clip-1');

      expect(mockDatabaseService.replayClip.delete).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
      });
      expect(mockDatabaseService.file.delete).toHaveBeenCalledWith({
        where: { id: 'file-1' },
      });
      expect(storageService.deleteFile).toHaveBeenCalledWith(
        '/uploads/replays/user-123/clip.mp4',
      );
    });

    it('should throw NotFoundException when clip not found', async () => {
      mockDatabaseService.replayClip.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteClip('user-123', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle file deletion failure gracefully', async () => {
      const clip = {
        id: 'clip-1',
        userId: 'user-123',
        fileId: 'file-1',
        file: {
          id: 'file-1',
          storagePath: '/uploads/replays/user-123/clip.mp4',
        },
      };

      mockDatabaseService.replayClip.findFirst.mockResolvedValue(clip);
      mockDatabaseService.replayClip.delete.mockResolvedValue(clip);
      mockDatabaseService.file.delete.mockResolvedValue(clip.file);
      storageService.deleteFile.mockRejectedValue(new Error('File not found'));

      // Should not throw, file might already be deleted
      await expect(
        service.deleteClip('user-123', 'clip-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('shareClip', () => {
    it('should share clip to channel', async () => {
      const clip = {
        id: 'clip-1',
        fileId: 'file-1',
        userId: 'user-123',
        durationSeconds: 60,
        file: {
          id: 'file-1',
          size: 10485760, // 10MB
        },
      };

      mockDatabaseService.replayClip.findFirst.mockResolvedValue(clip);
      mockDatabaseService.channel.findUnique.mockResolvedValue({
        id: 'channel-1',
        communityId: 'community-1',
      });
      mockDatabaseService.membership.findFirst.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-123',
        communityId: 'community-1',
      });
      eventEmitter.emitAsync.mockResolvedValue([{ messageId: 'message-1' }]);

      const result = await service.shareClip('user-123', 'clip-1', {
        destination: 'channel',
        targetChannelId: 'channel-1',
      });

      expect(result.messageId).toBe('message-1');
      expect(result.clipId).toBe('clip-1');
      expect(result.destination).toBe('channel');
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(CLIP_MESSAGE_CREATE, {
        authorId: 'user-123',
        fileId: 'file-1',
        durationSeconds: 60,
        sizeMB: 10,
        destination: 'channel',
        targetChannelId: 'channel-1',
        targetDirectMessageGroupId: undefined,
      });
    });

    it('should share clip to DM', async () => {
      const clip = {
        id: 'clip-1',
        fileId: 'file-1',
        userId: 'user-123',
        durationSeconds: 30,
        file: {
          id: 'file-1',
          size: 5242880, // 5MB
        },
      };

      mockDatabaseService.replayClip.findFirst.mockResolvedValue(clip);
      mockDatabaseService.directMessageGroupMember.findFirst.mockResolvedValue({
        id: 'dm-member-1',
        groupId: 'dm-group-1',
        userId: 'user-123',
      });
      eventEmitter.emitAsync.mockResolvedValue([{ messageId: 'message-1' }]);

      const result = await service.shareClip('user-123', 'clip-1', {
        destination: 'dm',
        targetDirectMessageGroupId: 'dm-group-1',
      });

      expect(result.messageId).toBe('message-1');
      expect(result.destination).toBe('dm');
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(CLIP_MESSAGE_CREATE, {
        authorId: 'user-123',
        fileId: 'file-1',
        durationSeconds: 30,
        sizeMB: 5,
        destination: 'dm',
        targetChannelId: undefined,
        targetDirectMessageGroupId: 'dm-group-1',
      });
    });

    it('should throw NotFoundException when clip not found', async () => {
      mockDatabaseService.replayClip.findFirst.mockResolvedValue(null);

      await expect(
        service.shareClip('user-123', 'nonexistent', {
          destination: 'channel',
          targetChannelId: 'channel-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
