import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { MessagesService } from './messages.service';
import { DatabaseService } from '@/database/database.service';
import { FileService } from '@/file/file.service';
import { NotFoundException } from '@nestjs/common';
import { SpanType, FileType } from '@prisma/client';
import { createMockDatabase, MessageFactory } from '@/test-utils';

/** Helper to build a message with included relations in the shape returned by Prisma */
function buildMessageWithIncludes(
  overrides: Record<string, unknown> = {},
  fileOverrides: Array<Record<string, unknown>> = [],
) {
  const base: any = MessageFactory.build(overrides as any);
  return {
    ...base,
    spans: (base.spans || []).map((s: any, i: number) => ({
      id: `span-${i}`,
      messageId: base.id,
      position: i,
      ...s,
    })),
    reactions: base.reactions || [],
    attachments: fileOverrides.map((f, i) => ({
      id: `ma-${i}`,
      messageId: base.id,
      fileId: (f as any).id,
      position: i,
      file: {
        id: (f as any).id,
        filename: (f as any).filename || 'file.bin',
        mimeType: (f as any).mimeType || 'application/octet-stream',
        fileType: (f as any).fileType || FileType.DOCUMENT,
        size: (f as any).size || 1024,
        thumbnailPath: (f as any).thumbnailPath ?? null,
      },
    })),
  };
}

describe('MessagesService', () => {
  let service: MessagesService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let fileService: Mocked<FileService>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(MessagesService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    fileService = unitRef.get(FileService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a message', async () => {
      const createDto = {
        channelId: 'channel-123',
        authorId: 'user-123',
        spans: [
          {
            type: SpanType.PLAINTEXT,
            text: 'Hello world',
            userId: null,
            specialKind: null,
            channelId: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any;
      const createdMessage = buildMessageWithIncludes(createDto);

      mockDatabase.message.create.mockResolvedValue(createdMessage);

      const result = await service.create(createDto);

      expect(result).toBeDefined();
      expect((result as any).channelId).toBe('channel-123');

      expect(mockDatabase.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channelId: 'channel-123',
          authorId: 'user-123',
          searchText: 'hello world',
          parentMessageId: null,
          spans: {
            create: [
              {
                position: 0,
                type: SpanType.PLAINTEXT,
                text: 'Hello world',
                userId: null,
                specialKind: null,
                channelId: null,
                communityId: null,
                aliasId: null,
              },
            ],
          },
        }),
        include: expect.objectContaining({
          spans: expect.any(Object),
          reactions: true,
          attachments: expect.any(Object),
        }),
      });
    });

    it('should exclude id field from Prisma create data', async () => {
      const createDto = {
        id: '',
        channelId: 'channel-123',
        authorId: 'user-123',
        spans: [
          {
            type: SpanType.PLAINTEXT,
            text: 'Replay clip',
            userId: null,
            specialKind: null,
            channelId: null,
            communityId: null,
            aliasId: null,
          },
        ],
        attachments: ['file-123'],
        pendingAttachments: 0,
      } as any;

      mockDatabase.message.create.mockResolvedValue(
        buildMessageWithIncludes(createDto),
      );

      await service.create(createDto);

      const callData = mockDatabase.message.create.mock.calls[0][0].data;
      expect(callData).not.toHaveProperty('id');
      expect(callData.channelId).toBe('channel-123');
      expect(callData.searchText).toBe('replay clip');
    });
  });

  describe('findOne', () => {
    it('should return a message by id', async () => {
      const message = buildMessageWithIncludes();

      mockDatabase.message.findUnique.mockResolvedValue(message);

      const result = await service.findOne(message.id);

      expect(result).toBeDefined();
      expect(mockDatabase.message.findUnique).toHaveBeenCalledWith({
        where: { id: message.id },
        include: expect.objectContaining({
          spans: expect.any(Object),
          reactions: true,
          attachments: expect.any(Object),
        }),
      });
    });

    it('should throw NotFoundException when message not found', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        'Message not found',
      );
    });
  });

  describe('update', () => {
    it('should update a message and set editedAt', async () => {
      const messageId = 'msg-123';
      const updateDto = {
        spans: [
          {
            type: SpanType.PLAINTEXT,
            text: 'Updated text',
            userId: null,
            specialKind: null,
            channelId: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any;
      const updatedMessage = buildMessageWithIncludes({
        id: messageId,
      });

      // The service uses $transaction which passes mockDatabase as tx
      mockDatabase.messageSpan.deleteMany.mockResolvedValue({ count: 1 });
      mockDatabase.messageSpan.createMany.mockResolvedValue({ count: 1 });
      mockDatabase.message.update.mockResolvedValue(updatedMessage);

      const result = await service.update(messageId, updateDto);

      expect(result).toBeDefined();
      // Verify spans were deleted and recreated
      expect(mockDatabase.messageSpan.deleteMany).toHaveBeenCalledWith({
        where: { messageId },
      });
      expect(mockDatabase.messageSpan.createMany).toHaveBeenCalledWith({
        data: [
          {
            messageId,
            position: 0,
            type: SpanType.PLAINTEXT,
            text: 'Updated text',
            userId: null,
            specialKind: null,
            channelId: null,
            communityId: null,
            aliasId: null,
          },
        ],
      });
      const updateCall = mockDatabase.message.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: messageId });
      expect(updateCall.data.searchText).toBe('updated text');
      expect(updateCall.data.editedAt).toBeInstanceOf(Date);
    });

    it('should mark removed attachments for deletion', async () => {
      const messageId = 'msg-123';
      const originalAttachments = ['file-1', 'file-2', 'file-3'];
      const newAttachments = ['file-1', 'file-3']; // file-2 removed
      const updateDto = { attachments: newAttachments };

      mockDatabase.messageAttachment.deleteMany.mockResolvedValue({ count: 1 });
      mockDatabase.messageAttachment.findMany.mockResolvedValue(
        newAttachments.map((fid) => ({ fileId: fid })),
      );
      mockDatabase.message.update.mockResolvedValue(
        buildMessageWithIncludes({ id: messageId }),
      );

      await service.update(messageId, updateDto, originalAttachments);

      // markForDeletion is called with fileId and transaction client
      expect(fileService.markForDeletion).toHaveBeenCalledWith(
        'file-2',
        expect.any(Object),
      );
      expect(fileService.markForDeletion).toHaveBeenCalledTimes(1);
    });

    it('should mark multiple removed attachments for deletion', async () => {
      const messageId = 'msg-123';
      const originalAttachments = ['file-1', 'file-2', 'file-3'];
      const newAttachments = ['file-1']; // file-2 and file-3 removed
      const updateDto = { attachments: newAttachments };

      mockDatabase.messageAttachment.deleteMany.mockResolvedValue({ count: 2 });
      mockDatabase.messageAttachment.findMany.mockResolvedValue(
        newAttachments.map((fid) => ({ fileId: fid })),
      );
      mockDatabase.message.update.mockResolvedValue(
        buildMessageWithIncludes({ id: messageId }),
      );

      await service.update(messageId, updateDto, originalAttachments);

      // markForDeletion is called with fileId and transaction client
      expect(fileService.markForDeletion).toHaveBeenCalledWith(
        'file-2',
        expect.any(Object),
      );
      expect(fileService.markForDeletion).toHaveBeenCalledWith(
        'file-3',
        expect.any(Object),
      );
      expect(fileService.markForDeletion).toHaveBeenCalledTimes(2);
    });

    it('should not set editedAt when only attachments are updated (no spans)', async () => {
      const messageId = 'msg-123';
      const updateDto = { attachments: ['file-1', 'file-2'] };

      mockDatabase.messageAttachment.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.messageAttachment.findMany.mockResolvedValue([]);
      mockDatabase.messageAttachment.createMany.mockResolvedValue({ count: 2 });
      mockDatabase.message.update.mockResolvedValue(
        buildMessageWithIncludes({ id: messageId }),
      );

      await service.update(messageId, updateDto);

      const updateCall = mockDatabase.message.update.mock.calls[0][0];
      expect(updateCall.data.editedAt).toBeUndefined();
    });

    it('should not mark files for deletion if no attachments changed', async () => {
      const messageId = 'msg-123';
      const updateDto = {
        spans: [
          {
            type: SpanType.PLAINTEXT,
            text: 'New text',
            userId: null,
            specialKind: null,
            channelId: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any;

      mockDatabase.messageSpan.deleteMany.mockResolvedValue({ count: 1 });
      mockDatabase.messageSpan.createMany.mockResolvedValue({ count: 1 });
      mockDatabase.message.update.mockResolvedValue(
        buildMessageWithIncludes({ id: messageId }),
      );

      await service.update(messageId, updateDto);

      expect(fileService.markForDeletion).not.toHaveBeenCalled();
    });

    it('should handle update errors', async () => {
      mockDatabase.message.update.mockRejectedValue(new Error('Update failed'));

      await expect(service.update('msg-id', {})).rejects.toThrow(
        'Update failed',
      );
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      // Default: no thread replies
      mockDatabase.message.findMany.mockResolvedValue([]);
      mockDatabase.message.deleteMany.mockResolvedValue({ count: 0 });
    });

    it('should delete a message', async () => {
      const messageId = 'msg-123';
      const deletedMessage = buildMessageWithIncludes({ id: messageId });

      mockDatabase.message.delete.mockResolvedValue(deletedMessage);

      const result = await service.remove(messageId);

      expect(result).toBeDefined();
      expect(mockDatabase.message.delete).toHaveBeenCalledWith({
        where: { id: messageId },
        include: expect.objectContaining({
          spans: expect.any(Object),
          reactions: true,
          attachments: expect.any(Object),
        }),
      });
    });

    it('should mark attachments for deletion when removing message', async () => {
      const messageId = 'msg-123';
      const file1 = {
        id: 'file-1',
        filename: 'a.png',
        mimeType: 'image/png',
        fileType: FileType.IMAGE,
        size: 100,
        thumbnailPath: null,
      };
      const file2 = {
        id: 'file-2',
        filename: 'b.png',
        mimeType: 'image/png',
        fileType: FileType.IMAGE,
        size: 200,
        thumbnailPath: null,
      };

      mockDatabase.message.delete.mockResolvedValue(
        buildMessageWithIncludes({ id: messageId }, [file1, file2]),
      );

      await service.remove(messageId);

      // markForDeletion is called with fileId and transaction client
      expect(fileService.markForDeletion).toHaveBeenCalledWith(
        'file-1',
        expect.any(Object),
      );
      expect(fileService.markForDeletion).toHaveBeenCalledWith(
        'file-2',
        expect.any(Object),
      );
      expect(fileService.markForDeletion).toHaveBeenCalledTimes(2);
    });

    it('should not mark files for deletion if no attachments', async () => {
      mockDatabase.message.delete.mockResolvedValue(buildMessageWithIncludes());

      await service.remove('msg-id');

      expect(fileService.markForDeletion).not.toHaveBeenCalled();
    });

    it('should handle delete errors', async () => {
      mockDatabase.message.delete.mockRejectedValue(new Error('Delete failed'));

      await expect(service.remove('msg-id')).rejects.toThrow('Delete failed');
    });

    it('should delete thread replies before deleting parent message', async () => {
      const parentId = 'parent-msg';
      const reply1 = {
        id: 'reply-1',
        parentMessageId: parentId,
        attachments: [],
      };
      const reply2 = {
        id: 'reply-2',
        parentMessageId: parentId,
        attachments: [],
      };

      mockDatabase.message.findMany.mockResolvedValue([reply1, reply2]);
      mockDatabase.message.deleteMany.mockResolvedValue({ count: 2 });
      mockDatabase.message.delete.mockResolvedValue(
        buildMessageWithIncludes({ id: parentId }),
      );

      await service.remove(parentId);

      // Should find thread replies
      expect(mockDatabase.message.findMany).toHaveBeenCalledWith({
        where: { parentMessageId: parentId },
        include: { attachments: { include: { file: true } } },
      });

      // Should delete all thread replies
      expect(mockDatabase.message.deleteMany).toHaveBeenCalledWith({
        where: { parentMessageId: parentId },
      });

      // Should delete the parent message
      expect(mockDatabase.message.delete).toHaveBeenCalledWith({
        where: { id: parentId },
        include: expect.objectContaining({
          spans: expect.any(Object),
          reactions: true,
          attachments: expect.any(Object),
        }),
      });
    });

    it('should mark thread reply attachments for deletion', async () => {
      const parentId = 'parent-msg';
      const replyFile = {
        id: 'reply-file-1',
        filename: 'reply-attachment.png',
        mimeType: 'image/png',
        fileType: FileType.IMAGE,
        size: 512,
        thumbnailPath: null,
      };
      const reply = {
        id: 'reply-1',
        parentMessageId: parentId,
        attachments: [{ file: replyFile }],
      };

      mockDatabase.message.findMany.mockResolvedValue([reply]);
      mockDatabase.message.deleteMany.mockResolvedValue({ count: 1 });
      mockDatabase.message.delete.mockResolvedValue(
        buildMessageWithIncludes({ id: parentId }),
      );

      await service.remove(parentId);

      expect(fileService.markForDeletion).toHaveBeenCalledWith(
        'reply-file-1',
        expect.any(Object),
      );
    });

    it('should not explicitly delete thread subscribers (cascade handles it)', async () => {
      const parentId = 'parent-msg';

      mockDatabase.message.delete.mockResolvedValue(
        buildMessageWithIncludes({ id: parentId }),
      );

      await service.remove(parentId);

      // ThreadSubscriber has onDelete: Cascade on parentMessage, so no explicit delete needed
      expect(mockDatabase.threadSubscriber.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('findAllForChannel', () => {
    it('should return messages for a channel', async () => {
      const channelId = 'channel-123';
      const messages = [
        buildMessageWithIncludes({ channelId }),
        buildMessageWithIncludes({ channelId }),
        buildMessageWithIncludes({ channelId }),
      ];

      mockDatabase.message.findMany.mockResolvedValue(messages);

      const result = await service.findAllForChannel(channelId);

      expect(result.messages).toHaveLength(3);
      expect(mockDatabase.message.findMany).toHaveBeenCalledWith({
        where: {
          channelId,
          parentMessageId: null,
        },
        orderBy: { sentAt: 'desc' },
        take: 50,
        include: expect.objectContaining({
          spans: expect.any(Object),
          reactions: true,
          attachments: expect.any(Object),
        }),
      });
    });

    it('should return continuation token when limit reached', async () => {
      const channelId = 'channel-123';
      const messages = Array.from({ length: 50 }, () =>
        buildMessageWithIncludes({ channelId }),
      );

      mockDatabase.message.findMany.mockResolvedValue(messages);

      const result = await service.findAllForChannel(channelId, 50);

      expect(result.continuationToken).toBe(messages[49].id);
    });

    it('should use continuation token for pagination', async () => {
      const channelId = 'channel-123';
      const continuationToken = 'msg-50';
      const messages = Array.from({ length: 10 }, () =>
        buildMessageWithIncludes({ channelId }),
      );

      mockDatabase.message.findMany.mockResolvedValue(messages);

      await service.findAllForChannel(channelId, 50, continuationToken);

      expect(mockDatabase.message.findMany).toHaveBeenCalledWith({
        where: {
          channelId,
          parentMessageId: null,
        },
        orderBy: { sentAt: 'desc' },
        take: 50,
        include: expect.objectContaining({
          spans: expect.any(Object),
          reactions: true,
          attachments: expect.any(Object),
        }),
        cursor: { id: continuationToken },
        skip: 1,
      });
    });

    it('should throw NotFoundException when no channelId provided', async () => {
      await expect(service.findAllForChannel('')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should format messages with file metadata from includes', async () => {
      const channelId = 'channel-123';
      const file1 = {
        id: 'file-1',
        filename: 'test.jpg',
        mimeType: 'image/jpeg',
        fileType: FileType.IMAGE,
        size: 1024,
        thumbnailPath: null,
      };
      const file2 = {
        id: 'file-2',
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        fileType: FileType.DOCUMENT,
        size: 2048,
        thumbnailPath: null,
      };
      const messages = [
        buildMessageWithIncludes({ channelId }, [file1, file2]),
      ];

      mockDatabase.message.findMany.mockResolvedValue(messages);

      const result = await service.findAllForChannel(channelId);

      expect(result.messages[0].attachments).toEqual([
        {
          id: file1.id,
          filename: file1.filename,
          mimeType: file1.mimeType,
          fileType: file1.fileType,
          size: file1.size,
          hasThumbnail: false,
        },
        {
          id: file2.id,
          filename: file2.filename,
          mimeType: file2.mimeType,
          fileType: file2.fileType,
          size: file2.size,
          hasThumbnail: false,
        },
      ]);
    });
  });

  describe('findAllByField with direction=newer', () => {
    it('should return newer messages in newest-first order', async () => {
      const channelId = 'channel-123';
      const cursorId = 'cursor-msg';
      // Prisma returns in asc order for newer
      const msg1 = buildMessageWithIncludes({
        channelId,
        sentAt: new Date('2026-01-01T10:00:00Z'),
      });
      const msg2 = buildMessageWithIncludes({
        channelId,
        sentAt: new Date('2026-01-01T11:00:00Z'),
      });
      const msg3 = buildMessageWithIncludes({
        channelId,
        sentAt: new Date('2026-01-01T12:00:00Z'),
      });

      // findMany returns asc order [msg1, msg2, msg3]
      mockDatabase.message.findMany.mockResolvedValue([msg1, msg2, msg3]);

      const result = await service.findAllForChannel(
        channelId,
        50,
        cursorId,
        'newer',
      );

      // Should be reversed to newest-first
      expect(result.messages[0]).toMatchObject({ id: msg3.id });
      expect(result.messages[1]).toMatchObject({ id: msg2.id });
      expect(result.messages[2]).toMatchObject({ id: msg1.id });

      expect(mockDatabase.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { sentAt: 'asc' },
          cursor: { id: cursorId },
          skip: 1,
        }),
      );
    });

    it('should return continuation token for newer direction when limit reached', async () => {
      const channelId = 'channel-123';
      const messages = Array.from({ length: 25 }, (_, i) =>
        buildMessageWithIncludes({
          channelId,
          sentAt: new Date(Date.now() + i * 1000),
        }),
      );

      // Save the last element's id before the service mutates the array via reverse()
      const newestMessageId = messages[messages.length - 1].id;

      mockDatabase.message.findMany.mockResolvedValue(messages);

      const result = await service.findAllForChannel(
        channelId,
        25,
        'cursor-msg',
        'newer',
      );

      // Token is computed before reverse — last element in asc order (newest message)
      expect(result.continuationToken).toBe(newestMessageId);
    });
  });

  describe('findAllForDirectMessageGroup', () => {
    it('should return messages for a DM group', async () => {
      const dmGroupId = 'dm-123';
      const messages = [
        buildMessageWithIncludes({
          directMessageGroupId: dmGroupId,
          channelId: null,
        }),
        buildMessageWithIncludes({
          directMessageGroupId: dmGroupId,
          channelId: null,
        }),
        buildMessageWithIncludes({
          directMessageGroupId: dmGroupId,
          channelId: null,
        }),
      ];

      mockDatabase.message.findMany.mockResolvedValue(messages);

      const result = await service.findAllForDirectMessageGroup(dmGroupId);

      expect(result.messages).toHaveLength(3);
      expect(mockDatabase.message.findMany).toHaveBeenCalledWith({
        where: {
          directMessageGroupId: dmGroupId,
          parentMessageId: null,
        },
        orderBy: { sentAt: 'desc' },
        take: 50,
        include: expect.objectContaining({
          spans: expect.any(Object),
          reactions: true,
          attachments: expect.any(Object),
        }),
      });
    });

    it('should throw NotFoundException when no dmGroupId provided', async () => {
      await expect(service.findAllForDirectMessageGroup('')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // Note: addReaction and removeReaction tests moved to reactions.service.spec.ts

  describe('addAttachment', () => {
    it('should add file to message attachments via junction table and decrement pending', async () => {
      const messageId = 'msg-123';
      const fileId = 'file-123';
      const updatedMessage = buildMessageWithIncludes(
        { id: messageId, pendingAttachments: 0 },
        [{ id: fileId, filename: 'test.bin' }],
      );

      mockDatabase.messageAttachment.aggregate.mockResolvedValue({
        _max: { position: 0 },
      });
      mockDatabase.messageAttachment.create.mockResolvedValue({
        id: 'ma-1',
        messageId,
        fileId,
        position: 1,
      });
      mockDatabase.message.findUnique.mockResolvedValue({
        pendingAttachments: 1,
      });
      mockDatabase.message.update.mockResolvedValue(updatedMessage);

      const result = await service.addAttachment(messageId, fileId);

      expect(result).toBeDefined();
      expect(mockDatabase.messageAttachment.aggregate).toHaveBeenCalledWith({
        where: { messageId },
        _max: { position: true },
      });
      expect(mockDatabase.messageAttachment.create).toHaveBeenCalledWith({
        data: { messageId, fileId, position: 1 },
      });
      expect(mockDatabase.message.findUnique).toHaveBeenCalledWith({
        where: { id: messageId },
        select: { pendingAttachments: true },
      });
      expect(mockDatabase.message.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: {
          pendingAttachments: { decrement: 1 },
        },
        include: expect.objectContaining({
          spans: expect.any(Object),
          reactions: true,
          attachments: expect.any(Object),
        }),
      });
    });

    it('should only decrement pending when no fileId provided', async () => {
      const messageId = 'msg-123';
      const updatedMessage = buildMessageWithIncludes({
        id: messageId,
        pendingAttachments: 1,
      });

      mockDatabase.message.findUnique.mockResolvedValue({
        pendingAttachments: 2,
      });
      mockDatabase.message.update.mockResolvedValue(updatedMessage);

      await service.addAttachment(messageId);

      expect(mockDatabase.messageAttachment.aggregate).not.toHaveBeenCalled();
      expect(mockDatabase.messageAttachment.create).not.toHaveBeenCalled();
      expect(mockDatabase.message.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: {
          pendingAttachments: { decrement: 1 },
        },
        include: expect.objectContaining({
          spans: expect.any(Object),
          reactions: true,
          attachments: expect.any(Object),
        }),
      });
    });

    it('should not decrement pending when pendingAttachments is already 0', async () => {
      const messageId = 'msg-123';
      const updatedMessage = buildMessageWithIncludes({
        id: messageId,
        pendingAttachments: 0,
      });

      mockDatabase.message.findUnique.mockResolvedValue({
        pendingAttachments: 0,
      });
      mockDatabase.message.update.mockResolvedValue(updatedMessage);

      await service.addAttachment(messageId);

      expect(mockDatabase.message.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: {},
        include: expect.objectContaining({
          spans: expect.any(Object),
          reactions: true,
          attachments: expect.any(Object),
        }),
      });
    });

    it('should handle errors when adding attachment', async () => {
      mockDatabase.messageAttachment.aggregate.mockResolvedValue({
        _max: { position: null },
      });
      mockDatabase.messageAttachment.create.mockResolvedValue({});
      mockDatabase.message.findUnique.mockResolvedValue({
        pendingAttachments: 1,
      });
      mockDatabase.message.update.mockRejectedValue(new Error('Update failed'));

      await expect(service.addAttachment('msg-id', 'file-id')).rejects.toThrow(
        'Update failed',
      );
    });
  });

  describe('enrichMessageWithFileMetadata', () => {
    it('should format message with included file metadata', async () => {
      const file1 = {
        id: 'file-1',
        filename: 'test.jpg',
        mimeType: 'image/jpeg',
        fileType: FileType.IMAGE,
        size: 1024,
        thumbnailPath: null,
      };
      const file2 = {
        id: 'file-2',
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        fileType: FileType.DOCUMENT,
        size: 2048,
        thumbnailPath: null,
      };
      const message = buildMessageWithIncludes({}, [file1, file2]);

      const result = await service.enrichMessageWithFileMetadata(message);

      // toFileMetadata strips thumbnailPath and adds hasThumbnail
      expect(result.attachments).toEqual([
        {
          id: file1.id,
          filename: file1.filename,
          mimeType: file1.mimeType,
          fileType: file1.fileType,
          size: file1.size,
          hasThumbnail: false,
        },
        {
          id: file2.id,
          filename: file2.filename,
          mimeType: file2.mimeType,
          fileType: file2.fileType,
          size: file2.size,
          hasThumbnail: false,
        },
      ]);
      // No file.findMany needed - data comes from includes
      expect(mockDatabase.file.findMany).not.toHaveBeenCalled();
    });

    it('should return empty attachments when message has no files', async () => {
      const message = buildMessageWithIncludes({});

      const result = await service.enrichMessageWithFileMetadata(message);

      expect(result.attachments).toEqual([]);
      expect(mockDatabase.file.findMany).not.toHaveBeenCalled();
    });

    it('should set hasThumbnail to true when file has thumbnailPath', async () => {
      const videoFile = {
        id: 'vid-1',
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        fileType: FileType.VIDEO,
        size: 5000,
        thumbnailPath: '/uploads/thumbnails/vid-1.jpg',
      };
      const imageFile = {
        id: 'img-1',
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        fileType: FileType.IMAGE,
        size: 2000,
        thumbnailPath: null,
      };
      const message = buildMessageWithIncludes({}, [videoFile, imageFile]);

      const result = await service.enrichMessageWithFileMetadata(message);

      expect(result.attachments).toHaveLength(2);
      expect(
        (result.attachments[0] as { hasThumbnail: boolean }).hasThumbnail,
      ).toBe(true);
      expect(
        (result.attachments[1] as { hasThumbnail: boolean }).hasThumbnail,
      ).toBe(false);
    });
  });

  describe('searchChannelMessages', () => {
    it('should return empty array for empty query', async () => {
      const result = await service.searchChannelMessages('channel-123', '');
      expect(result).toEqual([]);
      expect(mockDatabase.$queryRaw).not.toHaveBeenCalled();
    });

    it('should return empty array for whitespace-only query', async () => {
      const result = await service.searchChannelMessages('channel-123', '   ');
      expect(result).toEqual([]);
      expect(mockDatabase.$queryRaw).not.toHaveBeenCalled();
    });

    it('should use $queryRaw with searchVector and return enriched messages', async () => {
      const channelId = 'channel-123';
      const msg1 = buildMessageWithIncludes({ id: 'msg-1', channelId });
      const msg2 = buildMessageWithIncludes({ id: 'msg-2', channelId });

      // Raw query returns matching IDs in order
      mockDatabase.$queryRaw.mockResolvedValue([
        { id: 'msg-1' },
        { id: 'msg-2' },
      ]);
      // Enrichment query returns full messages (may be in different order)
      mockDatabase.message.findMany.mockResolvedValue([msg2, msg1]);

      const result = await service.searchChannelMessages(channelId, 'hello');

      expect(mockDatabase.$queryRaw).toHaveBeenCalled();
      expect(mockDatabase.message.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['msg-1', 'msg-2'] } },
        include: expect.objectContaining({
          spans: expect.any(Object),
          reactions: true,
          attachments: expect.any(Object),
        }),
      });
      expect(result).toHaveLength(2);
      // Should preserve order from raw query (msg-1 first)
      expect((result[0] as any).id).toBe('msg-1');
      expect((result[1] as any).id).toBe('msg-2');
    });

    it('should return empty array when raw query returns no results', async () => {
      mockDatabase.$queryRaw.mockResolvedValue([]);

      const result = await service.searchChannelMessages(
        'channel-123',
        'nonexistent',
      );

      expect(result).toEqual([]);
      // Should not call findMany when no raw results
      expect(mockDatabase.message.findMany).not.toHaveBeenCalled();
    });
  });

  describe('searchDirectMessages', () => {
    it('should return empty array for empty query', async () => {
      const result = await service.searchDirectMessages('dm-123', '');
      expect(result).toEqual([]);
      expect(mockDatabase.$queryRaw).not.toHaveBeenCalled();
    });

    it('should use $queryRaw with searchVector and return enriched messages', async () => {
      const dmGroupId = 'dm-123';
      const msg1 = buildMessageWithIncludes({
        id: 'msg-1',
        directMessageGroupId: dmGroupId,
        channelId: null,
      });

      mockDatabase.$queryRaw.mockResolvedValue([{ id: 'msg-1' }]);
      mockDatabase.message.findMany.mockResolvedValue([msg1]);

      const result = await service.searchDirectMessages(dmGroupId, 'hello');

      expect(mockDatabase.$queryRaw).toHaveBeenCalled();
      expect(mockDatabase.message.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['msg-1'] } },
        include: expect.objectContaining({
          spans: expect.any(Object),
          reactions: true,
          attachments: expect.any(Object),
        }),
      });
      expect(result).toHaveLength(1);
    });

    it('should return empty array when raw query returns no results', async () => {
      mockDatabase.$queryRaw.mockResolvedValue([]);

      const result = await service.searchDirectMessages(
        'dm-123',
        'nonexistent',
      );

      expect(result).toEqual([]);
      expect(mockDatabase.message.findMany).not.toHaveBeenCalled();
    });
  });

  describe('searchCommunityMessages', () => {
    it('should return empty array for empty query', async () => {
      const result = await service.searchCommunityMessages(
        'community-123',
        'user-123',
        '',
      );
      expect(result).toEqual([]);
    });

    it('should return empty array when user has no accessible channels', async () => {
      mockDatabase.channel.findMany.mockResolvedValue([]);

      const result = await service.searchCommunityMessages(
        'community-123',
        'user-123',
        'hello',
      );

      expect(result).toEqual([]);
      expect(mockDatabase.$queryRaw).not.toHaveBeenCalled();
    });

    it('should use $queryRaw with searchVector and enrich with channel names', async () => {
      const communityId = 'community-123';
      const userId = 'user-123';
      const channelId = 'channel-1';

      // Accessible channels
      mockDatabase.channel.findMany.mockResolvedValue([
        { id: channelId, name: 'general' },
      ]);

      const msg1 = buildMessageWithIncludes({
        id: 'msg-1',
        channelId,
      });

      // Raw query returns IDs with channelId
      mockDatabase.$queryRaw.mockResolvedValue([{ id: 'msg-1', channelId }]);
      // Enrichment query
      mockDatabase.message.findMany.mockResolvedValue([msg1]);

      const result = await service.searchCommunityMessages(
        communityId,
        userId,
        'hello',
      );

      expect(mockDatabase.channel.findMany).toHaveBeenCalledWith({
        where: {
          communityId,
          OR: [
            { isPrivate: false },
            {
              isPrivate: true,
              ChannelMembership: { some: { userId } },
            },
          ],
        },
        select: { id: true, name: true },
      });
      expect(mockDatabase.$queryRaw).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect((result[0] as any).channelName).toBe('general');
    });

    it('should return empty array when raw query returns no results', async () => {
      mockDatabase.channel.findMany.mockResolvedValue([
        { id: 'channel-1', name: 'general' },
      ]);
      mockDatabase.$queryRaw.mockResolvedValue([]);

      const result = await service.searchCommunityMessages(
        'community-123',
        'user-123',
        'nonexistent',
      );

      expect(result).toEqual([]);
      // Should not call message.findMany when no raw results
      expect(mockDatabase.message.findMany).not.toHaveBeenCalled();
    });

    it('should preserve order from raw query across multiple channels', async () => {
      mockDatabase.channel.findMany.mockResolvedValue([
        { id: 'ch-1', name: 'general' },
        { id: 'ch-2', name: 'random' },
      ]);

      const msg1 = buildMessageWithIncludes({ id: 'msg-1', channelId: 'ch-1' });
      const msg2 = buildMessageWithIncludes({ id: 'msg-2', channelId: 'ch-2' });
      const msg3 = buildMessageWithIncludes({ id: 'msg-3', channelId: 'ch-1' });

      // Raw query returns in sentAt DESC order
      mockDatabase.$queryRaw.mockResolvedValue([
        { id: 'msg-2', channelId: 'ch-2' },
        { id: 'msg-1', channelId: 'ch-1' },
        { id: 'msg-3', channelId: 'ch-1' },
      ]);
      // findMany may return in different order
      mockDatabase.message.findMany.mockResolvedValue([msg1, msg3, msg2]);

      const result = await service.searchCommunityMessages(
        'community-123',
        'user-123',
        'hello',
      );

      expect(result).toHaveLength(3);
      expect((result[0] as any).id).toBe('msg-2');
      expect((result[0] as any).channelName).toBe('random');
      expect((result[1] as any).id).toBe('msg-1');
      expect((result[1] as any).channelName).toBe('general');
      expect((result[2] as any).id).toBe('msg-3');
      expect((result[2] as any).channelName).toBe('general');
    });
  });

  describe('findAroundForChannel', () => {
    const channelId = 'channel-123';
    const anchorId = 'anchor-msg';

    function buildAnchorMessage() {
      return buildMessageWithIncludes({
        id: anchorId,
        channelId,
        sentAt: new Date('2026-01-15T12:00:00Z'),
        parentMessageId: null,
      });
    }

    it('should return anchor centered with older and newer messages', async () => {
      const anchor = buildAnchorMessage();
      const older1 = buildMessageWithIncludes({
        channelId,
        sentAt: new Date('2026-01-15T11:00:00Z'),
      });
      const older2 = buildMessageWithIncludes({
        channelId,
        sentAt: new Date('2026-01-15T10:00:00Z'),
      });
      const newer1 = buildMessageWithIncludes({
        channelId,
        sentAt: new Date('2026-01-15T13:00:00Z'),
      });
      const newer2 = buildMessageWithIncludes({
        channelId,
        sentAt: new Date('2026-01-15T14:00:00Z'),
      });

      // findUnique returns anchor
      mockDatabase.message.findUnique.mockResolvedValue(anchor);
      // First findMany call: older (desc order)
      // Second findMany call: newer (asc order)
      mockDatabase.message.findMany
        .mockResolvedValueOnce([older1, older2])
        .mockResolvedValueOnce([newer1, newer2]);

      const result = await service.findAroundForChannel(channelId, anchorId);

      // Result should be newest-first: [newer2, newer1, anchor, older1, older2]
      expect(result.messages).toHaveLength(5);
      expect(result.messages[0]).toMatchObject({ id: newer2.id });
      expect(result.messages[1]).toMatchObject({ id: newer1.id });
      expect(result.messages[2]).toMatchObject({ id: anchorId });
      expect(result.messages[3]).toMatchObject({ id: older1.id });
      expect(result.messages[4]).toMatchObject({ id: older2.id });
    });

    it('should set continuation tokens when both sides reach limit', async () => {
      const anchor = buildAnchorMessage();
      // Create exactly halfLimit (25) older and newer messages
      const olderMsgs = Array.from({ length: 25 }, (_, i) =>
        buildMessageWithIncludes({
          channelId,
          sentAt: new Date(Date.now() - (i + 1) * 60000),
        }),
      );
      const newerMsgs = Array.from({ length: 25 }, (_, i) =>
        buildMessageWithIncludes({
          channelId,
          sentAt: new Date(Date.now() + (i + 1) * 60000),
        }),
      );

      mockDatabase.message.findUnique.mockResolvedValue(anchor);
      mockDatabase.message.findMany
        .mockResolvedValueOnce(olderMsgs)
        .mockResolvedValueOnce(newerMsgs);

      const result = await service.findAroundForChannel(channelId, anchorId);

      expect(result.olderContinuationToken).toBe(olderMsgs[24].id);
      expect(result.newerContinuationToken).toBe(newerMsgs[24].id);
    });

    it('should omit continuation tokens when results do not fill half limit', async () => {
      const anchor = buildAnchorMessage();

      mockDatabase.message.findUnique.mockResolvedValue(anchor);
      mockDatabase.message.findMany
        .mockResolvedValueOnce([
          buildMessageWithIncludes({ channelId }),
        ]) // 1 older
        .mockResolvedValueOnce([]); // 0 newer

      const result = await service.findAroundForChannel(channelId, anchorId);

      expect(result.olderContinuationToken).toBeUndefined();
      expect(result.newerContinuationToken).toBeUndefined();
    });

    it('should throw NotFoundException for missing message', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(null);

      await expect(
        service.findAroundForChannel(channelId, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for message in wrong channel', async () => {
      const anchor = buildMessageWithIncludes({
        id: anchorId,
        channelId: 'other-channel',
        sentAt: new Date(),
        parentMessageId: null,
      });

      mockDatabase.message.findUnique.mockResolvedValue(anchor);

      await expect(
        service.findAroundForChannel(channelId, anchorId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for thread reply message', async () => {
      const anchor = buildMessageWithIncludes({
        id: anchorId,
        channelId,
        sentAt: new Date(),
        parentMessageId: 'some-parent',
      });

      mockDatabase.message.findUnique.mockResolvedValue(anchor);

      await expect(
        service.findAroundForChannel(channelId, anchorId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAroundForDirectMessageGroup', () => {
    it('should work for DM groups', async () => {
      const dmGroupId = 'dm-123';
      const anchorId = 'anchor-dm-msg';
      const anchor = buildMessageWithIncludes({
        id: anchorId,
        channelId: null,
        directMessageGroupId: dmGroupId,
        sentAt: new Date('2026-01-15T12:00:00Z'),
        parentMessageId: null,
      });

      mockDatabase.message.findUnique.mockResolvedValue(anchor);
      mockDatabase.message.findMany
        .mockResolvedValueOnce([]) // no older
        .mockResolvedValueOnce([]); // no newer

      const result = await service.findAroundForDirectMessageGroup(
        dmGroupId,
        anchorId,
      );

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toMatchObject({ id: anchorId });
      expect(result.olderContinuationToken).toBeUndefined();
      expect(result.newerContinuationToken).toBeUndefined();
    });
  });
});
