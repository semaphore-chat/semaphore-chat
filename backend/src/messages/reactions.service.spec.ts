import { TestBed } from '@suites/unit';
import { ReactionsService } from './reactions.service';
import { DatabaseService } from '@/database/database.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

describe('ReactionsService', () => {
  let service: ReactionsService;

  const messageId = randomUUID();
  const userId1 = randomUUID();
  const userId2 = randomUUID();

  const mockDatabaseService = {
    message: {
      findUnique: jest.fn(),
    },
    messageReaction: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    customEmoji: {
      findUnique: jest.fn(),
    },
    channel: {
      findUnique: jest.fn(),
    },
    membership: {
      findUnique: jest.fn(),
    },
    directMessageGroup: {
      findUnique: jest.fn(),
    },
    userBlock: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const { unit } = await TestBed.solitary(ReactionsService)
      .mock(DatabaseService)
      .final(mockDatabaseService)
      .compile();

    service = unit;

    jest.clearAllMocks();
    // No DM group, no block: non-DM tests never reach these, and a DM test
    // only sees one when it sets them up itself.
    mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue(null);
    mockDatabaseService.userBlock.findFirst.mockResolvedValue(null);
  });

  describe('addReaction', () => {
    it('should add a new reaction to a message', async () => {
      const message = {
        id: messageId,
        channelId: 'channel-1',
        directMessageGroupId: null,
      };

      const messageWithReactions = {
        ...message,
        reactions: [
          {
            emoji: '👍',
            userId: userId1,
            messageId,
            id: randomUUID(),
            createdAt: new Date(),
          },
        ],
      };

      // First call: existence check, second call: return with reactions
      mockDatabaseService.message.findUnique
        .mockResolvedValueOnce(message)
        .mockResolvedValueOnce(messageWithReactions);

      mockDatabaseService.messageReaction.upsert.mockResolvedValueOnce({
        id: randomUUID(),
        messageId,
        emoji: '👍',
        userId: userId1,
      });

      const result = await service.addReaction(messageId, '👍', userId1);

      expect(result.reactions).toHaveLength(1);
      expect(result.reactions[0].emoji).toBe('👍');

      // Verify existence check
      expect(mockDatabaseService.message.findUnique).toHaveBeenCalledTimes(2);
      expect(mockDatabaseService.message.findUnique).toHaveBeenNthCalledWith(
        1,
        {
          where: { id: messageId },
        },
      );

      // Verify upsert was called with compound unique key
      expect(mockDatabaseService.messageReaction.upsert).toHaveBeenCalledWith({
        where: {
          messageId_emoji_userId: { messageId, emoji: '👍', userId: userId1 },
        },
        create: { messageId, emoji: '👍', userId: userId1 },
        update: {},
      });
    });

    it('should be idempotent when user already reacted', async () => {
      const message = {
        id: messageId,
        channelId: 'channel-1',
        directMessageGroupId: null,
      };

      const messageWithReactions = {
        ...message,
        reactions: [
          {
            emoji: '👍',
            userId: userId1,
            messageId,
            id: randomUUID(),
            createdAt: new Date(),
          },
        ],
      };

      mockDatabaseService.message.findUnique
        .mockResolvedValueOnce(message)
        .mockResolvedValueOnce(messageWithReactions);

      // Upsert is a no-op when record already exists (update: {})
      mockDatabaseService.messageReaction.upsert.mockResolvedValueOnce({
        id: randomUUID(),
        messageId,
        emoji: '👍',
        userId: userId1,
      });

      const result = await service.addReaction(messageId, '👍', userId1);

      expect(result.reactions).toHaveLength(1);
      expect(mockDatabaseService.messageReaction.upsert).toHaveBeenCalledTimes(
        1,
      );
    });

    it('should add a second user to an existing emoji reaction', async () => {
      const message = {
        id: messageId,
        channelId: 'channel-1',
        directMessageGroupId: null,
      };

      const messageWithReactions = {
        ...message,
        reactions: [
          {
            emoji: '👍',
            userId: userId1,
            messageId,
            id: randomUUID(),
            createdAt: new Date(),
          },
          {
            emoji: '👍',
            userId: userId2,
            messageId,
            id: randomUUID(),
            createdAt: new Date(),
          },
        ],
      };

      mockDatabaseService.message.findUnique
        .mockResolvedValueOnce(message)
        .mockResolvedValueOnce(messageWithReactions);

      mockDatabaseService.messageReaction.upsert.mockResolvedValueOnce({
        id: randomUUID(),
        messageId,
        emoji: '👍',
        userId: userId2,
      });

      const result = await service.addReaction(messageId, '👍', userId2);

      // Result should have 2 reaction rows
      expect(result.reactions).toHaveLength(2);
    });

    it('should throw NotFoundException when message not found', async () => {
      mockDatabaseService.message.findUnique.mockResolvedValue(null);

      await expect(
        service.addReaction(randomUUID(), '👍', userId1),
      ).rejects.toThrow(NotFoundException);

      expect(mockDatabaseService.messageReaction.upsert).not.toHaveBeenCalled();
    });
  });

  describe('addReaction (block in a 1:1 DM)', () => {
    const groupId = randomUUID();
    const authorId = randomUUID();

    const dmMessage = {
      id: messageId,
      channelId: null,
      directMessageGroupId: groupId,
    };
    const dmMessageWithReactions = {
      ...dmMessage,
      reactions: [{ emoji: '👍', userId: userId1, messageId }],
    };

    const oneToOneDm = {
      isGroup: false,
      members: [{ userId: userId1 }, { userId: authorId }],
    };

    it('refuses a reaction when the other member blocked the reactor', async () => {
      mockDatabaseService.message.findUnique.mockResolvedValueOnce(dmMessage);
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValueOnce(
        oneToOneDm,
      );
      mockDatabaseService.userBlock.findFirst.mockResolvedValueOnce({
        id: randomUUID(),
      });

      await expect(
        service.addReaction(messageId, '👍', userId1),
      ).rejects.toThrow(ForbiddenException);

      expect(mockDatabaseService.messageReaction.upsert).not.toHaveBeenCalled();
    });

    it('allows a reaction when neither side blocked the other', async () => {
      mockDatabaseService.message.findUnique
        .mockResolvedValueOnce(dmMessage)
        .mockResolvedValueOnce(dmMessageWithReactions);
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValueOnce(
        oneToOneDm,
      );
      mockDatabaseService.messageReaction.upsert.mockResolvedValueOnce({});

      const result = await service.addReaction(messageId, '👍', userId1);

      expect(result.reactions).toHaveLength(1);
      expect(mockDatabaseService.userBlock.findFirst).toHaveBeenCalled();
    });

    it('leaves a group DM unaffected by a block', async () => {
      mockDatabaseService.message.findUnique
        .mockResolvedValueOnce(dmMessage)
        .mockResolvedValueOnce(dmMessageWithReactions);
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValueOnce({
        isGroup: true,
        members: [{ userId: userId1 }, { userId: authorId }],
      });
      mockDatabaseService.messageReaction.upsert.mockResolvedValueOnce({});

      await service.addReaction(messageId, '👍', userId1);

      expect(mockDatabaseService.userBlock.findFirst).not.toHaveBeenCalled();
      expect(mockDatabaseService.messageReaction.upsert).toHaveBeenCalled();
    });

    it('leaves a channel message unaffected by a block', async () => {
      const channelMessage = {
        id: messageId,
        channelId: randomUUID(),
        directMessageGroupId: null,
      };
      mockDatabaseService.message.findUnique
        .mockResolvedValueOnce(channelMessage)
        .mockResolvedValueOnce({ ...channelMessage, reactions: [] });
      mockDatabaseService.messageReaction.upsert.mockResolvedValueOnce({});

      await service.addReaction(messageId, '👍', userId1);

      expect(
        mockDatabaseService.directMessageGroup.findUnique,
      ).not.toHaveBeenCalled();
      expect(mockDatabaseService.messageReaction.upsert).toHaveBeenCalled();
    });

    it('still lets a user remove their own reaction in a blocked 1:1 DM', async () => {
      mockDatabaseService.message.findUnique
        .mockResolvedValueOnce(dmMessage)
        .mockResolvedValueOnce({ ...dmMessage, reactions: [] });
      mockDatabaseService.messageReaction.deleteMany.mockResolvedValueOnce({
        count: 1,
      });

      await service.removeReaction(messageId, '👍', userId1);

      expect(mockDatabaseService.userBlock.findFirst).not.toHaveBeenCalled();
      expect(
        mockDatabaseService.messageReaction.deleteMany,
      ).toHaveBeenCalledWith({
        where: { messageId, emoji: '👍', userId: userId1 },
      });
    });
  });

  describe('addReaction (custom emoji sentinel)', () => {
    const emojiId = randomUUID();
    const communityId = randomUUID();
    const channelId = randomUUID();
    const message = { id: messageId, channelId, directMessageGroupId: null };

    it('should accept a valid custom reaction for a community member', async () => {
      mockDatabaseService.message.findUnique
        .mockResolvedValueOnce(message)
        .mockResolvedValueOnce({ ...message, reactions: [] });
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce({
        id: emojiId,
        communityId,
      });
      mockDatabaseService.channel.findUnique.mockResolvedValueOnce({
        communityId,
      });
      mockDatabaseService.membership.findUnique.mockResolvedValueOnce({
        userId: userId1,
        communityId,
      });
      mockDatabaseService.messageReaction.upsert.mockResolvedValueOnce({});

      await service.addReaction(messageId, `custom:${emojiId}`, userId1);

      expect(mockDatabaseService.messageReaction.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: {
            messageId,
            emoji: `custom:${emojiId}`,
            userId: userId1,
          },
        }),
      );
    });

    it('should reject when the custom emoji does not exist', async () => {
      mockDatabaseService.message.findUnique.mockResolvedValueOnce(message);
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.addReaction(messageId, `custom:${emojiId}`, userId1),
      ).rejects.toThrow(BadRequestException);
      expect(mockDatabaseService.messageReaction.upsert).not.toHaveBeenCalled();
    });

    it('should reject a custom reaction on a DM message', async () => {
      mockDatabaseService.message.findUnique.mockResolvedValueOnce({
        id: messageId,
        channelId: null,
        directMessageGroupId: randomUUID(),
      });
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce({
        id: emojiId,
        communityId,
      });

      await expect(
        service.addReaction(messageId, `custom:${emojiId}`, userId1),
      ).rejects.toThrow(BadRequestException);
      expect(mockDatabaseService.messageReaction.upsert).not.toHaveBeenCalled();
    });

    it('should reject a custom emoji from another community', async () => {
      mockDatabaseService.message.findUnique.mockResolvedValueOnce(message);
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce({
        id: emojiId,
        communityId,
      });
      mockDatabaseService.channel.findUnique.mockResolvedValueOnce({
        communityId: randomUUID(), // different community
      });

      await expect(
        service.addReaction(messageId, `custom:${emojiId}`, userId1),
      ).rejects.toThrow(BadRequestException);
      expect(mockDatabaseService.messageReaction.upsert).not.toHaveBeenCalled();
    });

    it('should reject when reactor is not a community member', async () => {
      mockDatabaseService.message.findUnique.mockResolvedValueOnce(message);
      mockDatabaseService.customEmoji.findUnique.mockResolvedValueOnce({
        id: emojiId,
        communityId,
      });
      mockDatabaseService.channel.findUnique.mockResolvedValueOnce({
        communityId,
      });
      mockDatabaseService.membership.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.addReaction(messageId, `custom:${emojiId}`, userId1),
      ).rejects.toThrow(BadRequestException);
      expect(mockDatabaseService.messageReaction.upsert).not.toHaveBeenCalled();
    });
  });

  describe('removeReaction', () => {
    it('should remove user reaction from message', async () => {
      const message = {
        id: messageId,
        channelId: 'channel-1',
        directMessageGroupId: null,
      };

      const messageWithReactions = {
        ...message,
        reactions: [
          {
            emoji: '👍',
            userId: userId2,
            messageId,
            id: randomUUID(),
            createdAt: new Date(),
          },
        ],
      };

      mockDatabaseService.message.findUnique
        .mockResolvedValueOnce(message)
        .mockResolvedValueOnce(messageWithReactions);

      mockDatabaseService.messageReaction.deleteMany.mockResolvedValueOnce({
        count: 1,
      });

      const result = await service.removeReaction(messageId, '👍', userId1);

      expect(result.reactions).toHaveLength(1);
      expect(result.reactions[0].userId).toBe(userId2);

      expect(
        mockDatabaseService.messageReaction.deleteMany,
      ).toHaveBeenCalledWith({
        where: { messageId, emoji: '👍', userId: userId1 },
      });
    });

    it('should return empty reactions when last user removes reaction', async () => {
      const message = {
        id: messageId,
        channelId: 'channel-1',
        directMessageGroupId: null,
      };

      const messageWithReactions = {
        ...message,
        reactions: [],
      };

      mockDatabaseService.message.findUnique
        .mockResolvedValueOnce(message)
        .mockResolvedValueOnce(messageWithReactions);

      mockDatabaseService.messageReaction.deleteMany.mockResolvedValueOnce({
        count: 1,
      });

      const result = await service.removeReaction(messageId, '👍', userId1);

      expect(result.reactions).toHaveLength(0);
    });

    it('should handle removing non-existent reaction gracefully', async () => {
      const message = {
        id: messageId,
        channelId: 'channel-1',
        directMessageGroupId: null,
      };

      mockDatabaseService.message.findUnique
        .mockResolvedValueOnce(message)
        .mockResolvedValueOnce({ ...message, reactions: [] });

      // deleteMany returns count: 0 when nothing matched
      mockDatabaseService.messageReaction.deleteMany.mockResolvedValueOnce({
        count: 0,
      });

      const result = await service.removeReaction(messageId, '👍', userId1);

      expect(result.reactions).toHaveLength(0);
    });

    it('should throw NotFoundException when message not found', async () => {
      mockDatabaseService.message.findUnique.mockResolvedValue(null);

      await expect(
        service.removeReaction(randomUUID(), '👍', userId1),
      ).rejects.toThrow(NotFoundException);

      expect(
        mockDatabaseService.messageReaction.deleteMany,
      ).not.toHaveBeenCalled();
    });
  });
});
