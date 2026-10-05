import { TestBed } from '@suites/unit';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ThreadsService } from './threads.service';
import { DatabaseService } from '@/database/database.service';
import { ChannelAccessService } from '@/roles/channel-access.service';
import type { Mocked } from '@suites/doubles.jest';
import { createMockDatabase, MessageFactory } from '@/test-utils';

describe('ThreadsService', () => {
  let service: ThreadsService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let channelAccessService: Mocked<ChannelAccessService>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(ThreadsService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    channelAccessService = unitRef.get(ChannelAccessService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getParentMessage', () => {
    it('should return parent message when found', async () => {
      const parent = MessageFactory.build({ parentMessageId: null });
      mockDatabase.message.findUnique.mockResolvedValue(parent);

      const result = await service.getParentMessage(parent.id);

      expect(result).toEqual(parent);
      expect(mockDatabase.message.findUnique).toHaveBeenCalledWith({
        where: { id: parent.id },
      });
    });

    it('should throw NotFoundException when parent not found', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(null);

      await expect(service.getParentMessage('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for nested threads', async () => {
      const reply = MessageFactory.build({ parentMessageId: 'some-parent-id' });
      mockDatabase.message.findUnique.mockResolvedValue(reply);

      await expect(service.getParentMessage(reply.id)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createThreadReply', () => {
    const authorId = 'author-123';

    describe('#channel mentions', () => {
      const parent = () =>
        MessageFactory.build({
          id: 'parent-msg-123',
          channelId: 'channel-456',
          directMessageGroupId: null,
          parentMessageId: null,
        });
      const mentionDto = (channelId: string) => ({
        parentMessageId: 'parent-msg-123',
        spans: [
          {
            type: 'CHANNEL_MENTION' as any,
            text: '#secret-name',
            channelId,
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      });

      beforeEach(() => {
        mockDatabase.message.findUnique.mockResolvedValue(parent());
        mockDatabase.message.create.mockResolvedValue(
          MessageFactory.build({ parentMessageId: 'parent-msg-123' }),
        );
        mockDatabase.message.update.mockResolvedValue(parent());
        mockDatabase.threadSubscriber.upsert.mockResolvedValue({});
        mockDatabase.channel.findUnique.mockResolvedValue({
          communityId: 'c1',
        });
        mockDatabase.channel.findMany.mockImplementation(
          ({ where }: { where: { id: { in: string[] } } }) =>
            Promise.resolve(where.id.in.map((id) => ({ id }))),
        );
      });

      it('keeps a visible channel mention with no name stored', async () => {
        channelAccessService.canViewChannel.mockResolvedValue(true);
        await service.createThreadReply(mentionDto('visible'), authorId);
        const data = mockDatabase.message.create.mock.calls[0][0].data;
        expect(data.spans.create[0]).toMatchObject({
          type: 'CHANNEL_MENTION',
          channelId: 'visible',
          text: null,
        });
        expect(data.searchText ?? '').not.toContain('secret-name');
      });

      it('downgrades a mention of a channel the author cannot see', async () => {
        channelAccessService.canViewChannel.mockResolvedValue(false);
        await service.createThreadReply(mentionDto('hidden'), authorId);
        const data = mockDatabase.message.create.mock.calls[0][0].data;
        expect(data.spans.create[0]).toMatchObject({
          type: 'PLAINTEXT',
          channelId: null,
          text: '#unknown-channel',
        });
        expect(data.searchText ?? '').not.toContain('secret-name');
      });
    });

    const parentMessageId = 'parent-msg-123';
    const channelId = 'channel-456';

    const dto = {
      parentMessageId,
      spans: [
        {
          type: 'PLAINTEXT' as any,
          text: 'Hello thread',
          userId: null,
          specialKind: null,
          communityId: null,
          aliasId: null,
        },
      ],
      attachments: [],
      pendingAttachments: 0,
    };

    it('should create a thread reply in a channel context', async () => {
      const parent = MessageFactory.build({
        id: parentMessageId,
        channelId,
        directMessageGroupId: null,
        parentMessageId: null,
      });
      const reply = MessageFactory.build({
        authorId,
        channelId,
        parentMessageId,
      });

      mockDatabase.message.findUnique.mockResolvedValue(parent);
      mockDatabase.message.create.mockResolvedValue(reply);
      mockDatabase.message.update.mockResolvedValue(parent);
      mockDatabase.threadSubscriber.upsert.mockResolvedValue({});

      const result = await service.createThreadReply(dto, authorId);

      expect(result).toMatchObject(reply);
      expect(result).toHaveProperty('spans');
      expect(result).toHaveProperty('reactions');
      expect(result).toHaveProperty('attachments');
      expect(mockDatabase.$transaction).toHaveBeenCalled();
      expect(mockDatabase.message.create).toHaveBeenCalled();
      expect(mockDatabase.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: parentMessageId },
          data: expect.objectContaining({
            replyCount: { increment: 1 },
          }),
        }),
      );
    });

    it('should create a thread reply in a DM context', async () => {
      const dmGroupId = 'dm-group-123';
      const parent = MessageFactory.build({
        id: parentMessageId,
        channelId: null,
        directMessageGroupId: dmGroupId,
        parentMessageId: null,
      });
      const reply = MessageFactory.build({
        authorId,
        directMessageGroupId: dmGroupId,
        parentMessageId,
      });

      mockDatabase.message.findUnique.mockResolvedValue(parent);
      mockDatabase.message.create.mockResolvedValue(reply);
      mockDatabase.message.update.mockResolvedValue(parent);
      mockDatabase.threadSubscriber.upsert.mockResolvedValue({});

      const result = await service.createThreadReply(
        { ...dto, parentMessageId },
        authorId,
      );

      expect(result).toMatchObject(reply);
    });

    it('should auto-subscribe the replier to the thread', async () => {
      const parent = MessageFactory.build({
        id: parentMessageId,
        channelId,
        directMessageGroupId: null,
        parentMessageId: null,
      });
      const reply = MessageFactory.build({ authorId, parentMessageId });

      mockDatabase.message.findUnique.mockResolvedValue(parent);
      mockDatabase.message.create.mockResolvedValue(reply);
      mockDatabase.message.update.mockResolvedValue(parent);
      mockDatabase.threadSubscriber.upsert.mockResolvedValue({});

      await service.createThreadReply(dto, authorId);

      expect(mockDatabase.threadSubscriber.upsert).toHaveBeenCalledWith({
        where: {
          userId_parentMessageId: { userId: authorId, parentMessageId },
        },
        create: { userId: authorId, parentMessageId },
        update: {},
      });
    });

    it('should sanitize spans to only include valid fields', async () => {
      const parent = MessageFactory.build({
        id: parentMessageId,
        channelId,
        directMessageGroupId: null,
        parentMessageId: null,
      });
      const reply = MessageFactory.build({ authorId, parentMessageId });

      const dtoWithExtraFields = {
        parentMessageId,
        spans: [
          {
            type: 'PLAINTEXT' as any,
            text: 'Hello',
            extraField: 'should be stripped',
          },
        ],
      };

      mockDatabase.message.findUnique.mockResolvedValue(parent);
      mockDatabase.message.create.mockResolvedValue(reply);
      mockDatabase.message.update.mockResolvedValue(parent);
      mockDatabase.threadSubscriber.upsert.mockResolvedValue({});

      await service.createThreadReply(dtoWithExtraFields as any, authorId);

      const createCall = mockDatabase.message.create.mock.calls[0][0];
      const spans = createCall.data.spans.create;
      expect(spans[0]).not.toHaveProperty('extraField');
      expect(spans[0]).toEqual({
        position: 0,
        type: 'PLAINTEXT',
        text: 'Hello',
        userId: null,
        specialKind: null,
        communityId: null,
        channelId: null,
        aliasId: null,
        emojiId: null,
        bold: null,
        italic: null,
        strikethrough: null,
        code: null,
      });
    });

    it('keeps a valid community emoji span in a channel thread reply', async () => {
      const parent = MessageFactory.build({
        id: parentMessageId,
        channelId,
        directMessageGroupId: null,
        parentMessageId: null,
      });
      const reply = MessageFactory.build({ authorId, parentMessageId });
      const emojiDto = {
        parentMessageId,
        spans: [{ type: 'EMOJI' as any, text: ':smile:', emojiId: 'emoji-1' }],
      };

      mockDatabase.message.findUnique.mockResolvedValue(parent);
      mockDatabase.channel.findUnique.mockResolvedValue({
        communityId: 'community-1',
      });
      mockDatabase.customEmoji.findMany.mockResolvedValue([{ id: 'emoji-1' }]);
      mockDatabase.message.create.mockResolvedValue(reply);
      mockDatabase.message.update.mockResolvedValue(parent);
      mockDatabase.threadSubscriber.upsert.mockResolvedValue({});

      await service.createThreadReply(emojiDto as any, authorId);

      const spans =
        mockDatabase.message.create.mock.calls[0][0].data.spans.create;
      expect(spans[0]).toMatchObject({ type: 'EMOJI', emojiId: 'emoji-1' });
    });

    it('downgrades an unknown emojiId to PLAINTEXT in a thread reply', async () => {
      const parent = MessageFactory.build({
        id: parentMessageId,
        channelId,
        directMessageGroupId: null,
        parentMessageId: null,
      });
      const reply = MessageFactory.build({ authorId, parentMessageId });
      const emojiDto = {
        parentMessageId,
        spans: [
          { type: 'EMOJI' as any, text: ':ghost:', emojiId: 'does-not-exist' },
        ],
      };

      mockDatabase.message.findUnique.mockResolvedValue(parent);
      mockDatabase.channel.findUnique.mockResolvedValue({
        communityId: 'community-1',
      });
      mockDatabase.customEmoji.findMany.mockResolvedValue([]);
      mockDatabase.message.create.mockResolvedValue(reply);
      mockDatabase.message.update.mockResolvedValue(parent);
      mockDatabase.threadSubscriber.upsert.mockResolvedValue({});

      await service.createThreadReply(emojiDto as any, authorId);

      const spans =
        mockDatabase.message.create.mock.calls[0][0].data.spans.create;
      expect(spans[0]).toMatchObject({
        type: 'PLAINTEXT',
        text: ':ghost:',
        emojiId: null,
      });
    });

    it('downgrades emoji spans in a DM thread reply (no community)', async () => {
      const dmGroupId = 'dm-group-999';
      const parent = MessageFactory.build({
        id: parentMessageId,
        channelId: null,
        directMessageGroupId: dmGroupId,
        parentMessageId: null,
      });
      const reply = MessageFactory.build({
        authorId,
        directMessageGroupId: dmGroupId,
        parentMessageId,
      });
      const emojiDto = {
        parentMessageId,
        spans: [{ type: 'EMOJI' as any, text: ':smile:', emojiId: 'emoji-1' }],
      };

      mockDatabase.message.findUnique.mockResolvedValue(parent);
      mockDatabase.message.create.mockResolvedValue(reply);
      mockDatabase.message.update.mockResolvedValue(parent);
      mockDatabase.threadSubscriber.upsert.mockResolvedValue({});

      await service.createThreadReply(emojiDto as any, authorId);

      const spans =
        mockDatabase.message.create.mock.calls[0][0].data.spans.create;
      expect(spans[0]).toMatchObject({ type: 'PLAINTEXT', emojiId: null });
      expect(mockDatabase.channel.findUnique).not.toHaveBeenCalled();
    });

    it('should throw when parent message is itself a thread reply', async () => {
      const nestedParent = MessageFactory.build({
        id: parentMessageId,
        parentMessageId: 'grandparent-id',
      });
      mockDatabase.message.findUnique.mockResolvedValue(nestedParent);

      await expect(service.createThreadReply(dto, authorId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getThreadReplies', () => {
    const parentMessageId = 'parent-msg-123';

    it('should return paginated replies', async () => {
      const replies = MessageFactory.buildMany(3, { parentMessageId });
      mockDatabase.message.findUnique.mockResolvedValue({
        id: parentMessageId,
      });
      mockDatabase.message.findMany.mockResolvedValue(replies);

      const result = await service.getThreadReplies(parentMessageId, 50);

      expect(result.replies).toEqual(replies);
      expect(result.continuationToken).toBeUndefined();
    });

    it('should return continuation token when results equal limit', async () => {
      const replies = MessageFactory.buildMany(2, { parentMessageId });
      mockDatabase.message.findUnique.mockResolvedValue({
        id: parentMessageId,
      });
      mockDatabase.message.findMany.mockResolvedValue(replies);

      const result = await service.getThreadReplies(parentMessageId, 2);

      expect(result.continuationToken).toBe(replies[1].id);
    });

    it('should use cursor when continuation token provided', async () => {
      const token = 'cursor-id-123';
      mockDatabase.message.findUnique.mockResolvedValue({
        id: parentMessageId,
      });
      mockDatabase.message.findMany.mockResolvedValue([]);

      await service.getThreadReplies(parentMessageId, 50, token);

      expect(mockDatabase.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: token },
          skip: 1,
        }),
      );
    });

    it('should throw NotFoundException when parent not found', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(null);

      await expect(service.getThreadReplies('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getThreadRepliesWithMetadata', () => {
    const parentMessageId = 'parent-msg-123';

    it('should enrich replies with file metadata', async () => {
      const fileId = 'file-123';
      const reply = {
        ...MessageFactory.build({ parentMessageId }),
        spans: [],
        reactions: [],
        attachments: [
          {
            id: 'att-1',
            messageId: 'msg-1',
            fileId,
            position: 0,
            file: {
              id: fileId,
              filename: 'test.png',
              mimeType: 'image/png',
              fileType: 'IMAGE',
              size: 1024,
              thumbnailPath: '/thumbnails/test.png',
            },
          },
        ],
      };

      mockDatabase.message.findUnique.mockResolvedValue({
        id: parentMessageId,
      });
      mockDatabase.message.findMany.mockResolvedValue([reply]);

      const result =
        await service.getThreadRepliesWithMetadata(parentMessageId);

      expect(result.replies).toHaveLength(1);
      expect(result.replies[0].attachments).toEqual([
        expect.objectContaining({
          id: fileId,
          filename: 'test.png',
          hasThumbnail: true,
        }),
      ]);
    });

    it('should convert thumbnailPath to hasThumbnail boolean', async () => {
      const fileId = 'file-123';
      const reply = {
        ...MessageFactory.build({ parentMessageId }),
        spans: [],
        reactions: [],
        attachments: [
          {
            id: 'att-1',
            messageId: 'msg-1',
            fileId,
            position: 0,
            file: {
              id: fileId,
              filename: 'test.png',
              mimeType: 'image/png',
              fileType: 'IMAGE',
              size: 1024,
              thumbnailPath: null,
            },
          },
        ],
      };

      mockDatabase.message.findUnique.mockResolvedValue({
        id: parentMessageId,
      });
      mockDatabase.message.findMany.mockResolvedValue([reply]);

      const result =
        await service.getThreadRepliesWithMetadata(parentMessageId);

      expect(result.replies[0].attachments[0].hasThumbnail).toBe(false);
    });

    it('should return empty attachments when no attachments', async () => {
      const reply = {
        ...MessageFactory.build({ parentMessageId }),
        spans: [],
        reactions: [],
        attachments: [],
      };

      mockDatabase.message.findUnique.mockResolvedValue({
        id: parentMessageId,
      });
      mockDatabase.message.findMany.mockResolvedValue([reply]);

      const result =
        await service.getThreadRepliesWithMetadata(parentMessageId);

      expect(result.replies[0].attachments).toEqual([]);
    });
  });

  describe('subscribeToThread', () => {
    const parentMessageId = 'parent-msg-123';
    const userId = 'user-123';

    it('should upsert thread subscription', async () => {
      const parent = MessageFactory.build({
        id: parentMessageId,
        parentMessageId: null,
      });
      mockDatabase.message.findUnique.mockResolvedValue(parent);
      mockDatabase.threadSubscriber.upsert.mockResolvedValue({});

      await service.subscribeToThread(parentMessageId, userId);

      expect(mockDatabase.threadSubscriber.upsert).toHaveBeenCalledWith({
        where: {
          userId_parentMessageId: { userId, parentMessageId },
        },
        create: { userId, parentMessageId },
        update: {},
      });
    });

    it('should verify parent message exists', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(null);

      await expect(
        service.subscribeToThread(parentMessageId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('unsubscribeFromThread', () => {
    it('should delete thread subscription', async () => {
      const parentMessageId = 'parent-msg-123';
      const userId = 'user-123';
      mockDatabase.threadSubscriber.deleteMany.mockResolvedValue({ count: 1 });

      await service.unsubscribeFromThread(parentMessageId, userId);

      expect(mockDatabase.threadSubscriber.deleteMany).toHaveBeenCalledWith({
        where: { userId, parentMessageId },
      });
    });
  });

  describe('getThreadSubscribers', () => {
    const parentMessageId = 'parent-msg-123';

    it('should return subscriber user IDs', async () => {
      mockDatabase.threadSubscriber.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);

      const result = await service.getThreadSubscribers(parentMessageId);

      expect(result).toEqual(['user-1', 'user-2']);
    });

    it('should exclude specified user', async () => {
      mockDatabase.threadSubscriber.findMany.mockResolvedValue([
        { userId: 'user-2' },
      ]);

      await service.getThreadSubscribers(parentMessageId, 'user-1');

      expect(mockDatabase.threadSubscriber.findMany).toHaveBeenCalledWith({
        where: {
          parentMessageId,
          userId: { not: 'user-1' },
        },
        select: { userId: true },
      });
    });

    it('should return empty array when no subscribers', async () => {
      mockDatabase.threadSubscriber.findMany.mockResolvedValue([]);

      const result = await service.getThreadSubscribers(parentMessageId);

      expect(result).toEqual([]);
    });
  });

  describe('isSubscribed', () => {
    it('should return true when subscribed', async () => {
      mockDatabase.threadSubscriber.findUnique.mockResolvedValue({
        userId: 'user-1',
        parentMessageId: 'msg-1',
      });

      const result = await service.isSubscribed('msg-1', 'user-1');

      expect(result).toBe(true);
    });

    it('should return false when not subscribed', async () => {
      mockDatabase.threadSubscriber.findUnique.mockResolvedValue(null);

      const result = await service.isSubscribed('msg-1', 'user-1');

      expect(result).toBe(false);
    });
  });

  describe('getThreadMetadata', () => {
    const parentMessageId = 'parent-msg-123';
    const lastReplyAt = new Date();

    it('should return metadata with subscription status', async () => {
      mockDatabase.message.findUnique.mockResolvedValue({
        id: parentMessageId,
        replyCount: 5,
        lastReplyAt,
      });
      mockDatabase.threadSubscriber.findUnique.mockResolvedValue({
        userId: 'user-1',
      });

      const result = await service.getThreadMetadata(parentMessageId, 'user-1');

      expect(result).toEqual({
        parentMessageId,
        replyCount: 5,
        lastReplyAt,
        isSubscribed: true,
      });
    });

    it('should return isSubscribed false when no userId provided', async () => {
      mockDatabase.message.findUnique.mockResolvedValue({
        id: parentMessageId,
        replyCount: 0,
        lastReplyAt: null,
      });

      const result = await service.getThreadMetadata(parentMessageId);

      expect(result.isSubscribed).toBe(false);
    });

    it('should throw NotFoundException when message not found', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(null);

      await expect(service.getThreadMetadata('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('decrementReplyCount', () => {
    it('should decrement parent reply count', async () => {
      const parentMessageId = 'parent-msg-123';
      mockDatabase.message.update.mockResolvedValue({});

      await service.decrementReplyCount(parentMessageId);

      expect(mockDatabase.message.update).toHaveBeenCalledWith({
        where: { id: parentMessageId },
        data: { replyCount: { decrement: 1 } },
      });
    });
  });
});
