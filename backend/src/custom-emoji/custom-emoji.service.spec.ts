import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ResourceType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { CustomEmojiService } from './custom-emoji.service';
import { DatabaseService } from '@/database/database.service';
import { RoomEvents } from '@/rooms/room-subscription.events';

describe('CustomEmojiService', () => {
  let service: CustomEmojiService;
  let eventEmitter: Mocked<EventEmitter2>;

  const communityId = randomUUID();
  const otherCommunityId = randomUUID();
  const fileId = randomUUID();
  const emojiId = randomUUID();
  const userId = randomUUID();

  const mockDatabaseService = {
    customEmoji: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    file: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(CustomEmojiService)
      .mock(DatabaseService)
      .final(mockDatabaseService)
      .compile();

    service = unit;
    eventEmitter = unitRef.get(EventEmitter2);
    jest.clearAllMocks();
  });

  const validFile = {
    id: fileId,
    deletedAt: null,
    resourceType: ResourceType.CUSTOM_EMOJI,
    fileCommunityId: communityId,
  };

  describe('listCommunityEmojis', () => {
    it('returns mapped emoji DTOs for a community', async () => {
      mockDatabaseService.customEmoji.findMany.mockResolvedValueOnce([
        {
          id: emojiId,
          communityId,
          name: 'party_blob',
          fileId,
          createdBy: userId,
          createdAt: new Date(),
        },
      ]);

      const result = await service.listCommunityEmojis(communityId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('party_blob');
      expect(mockDatabaseService.customEmoji.findMany).toHaveBeenCalledWith({
        where: { communityId },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('createEmoji', () => {
    it('creates an emoji from a valid CUSTOM_EMOJI file', async () => {
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce(null);
      mockDatabaseService.file.findUnique.mockResolvedValueOnce(validFile);
      mockDatabaseService.customEmoji.create.mockResolvedValueOnce({
        id: emojiId,
        communityId,
        name: 'party_blob',
        fileId,
        createdBy: userId,
        createdAt: new Date(),
      });

      const result = await service.createEmoji(
        communityId,
        { name: 'party_blob', fileId },
        userId,
      );

      expect(result.id).toBe(emojiId);
      expect(mockDatabaseService.customEmoji.create).toHaveBeenCalledWith({
        data: { communityId, name: 'party_blob', fileId, createdBy: userId },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.CUSTOM_EMOJI_CREATED,
        { communityId, emojiId },
      );
    });

    it('rejects a duplicate name within the same community', async () => {
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce({
        id: emojiId,
      });

      await expect(
        service.createEmoji(
          communityId,
          { name: 'party_blob', fileId },
          userId,
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockDatabaseService.customEmoji.create).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('rejects when the file does not exist', async () => {
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce(null);
      mockDatabaseService.file.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.createEmoji(
          communityId,
          { name: 'party_blob', fileId },
          userId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the file is not a CUSTOM_EMOJI file', async () => {
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce(null);
      mockDatabaseService.file.findUnique.mockResolvedValueOnce({
        ...validFile,
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
      });

      await expect(
        service.createEmoji(
          communityId,
          { name: 'party_blob', fileId },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the file belongs to another community', async () => {
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce(null);
      mockDatabaseService.file.findUnique.mockResolvedValueOnce({
        ...validFile,
        fileCommunityId: otherCommunityId,
      });

      await expect(
        service.createEmoji(
          communityId,
          { name: 'party_blob', fileId },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteEmoji', () => {
    it('deletes an emoji that belongs to the community', async () => {
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce({
        id: emojiId,
        communityId,
        name: 'party_blob',
      });
      mockDatabaseService.customEmoji.delete.mockResolvedValueOnce({});

      await service.deleteEmoji(communityId, emojiId);

      expect(mockDatabaseService.customEmoji.delete).toHaveBeenCalledWith({
        where: { id: emojiId },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.CUSTOM_EMOJI_DELETED,
        { communityId, emojiId },
      );
    });

    it('throws NotFound when the emoji is missing', async () => {
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce(null);

      await expect(service.deleteEmoji(communityId, emojiId)).rejects.toThrow(
        NotFoundException,
      );
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('throws NotFound when the emoji belongs to another community', async () => {
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce({
        id: emojiId,
        communityId: otherCommunityId,
        name: 'party_blob',
      });

      await expect(service.deleteEmoji(communityId, emojiId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockDatabaseService.customEmoji.delete).not.toHaveBeenCalled();
    });
  });
});
