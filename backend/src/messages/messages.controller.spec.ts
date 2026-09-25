import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ReactionsService } from './reactions.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { MessageFactory, UserFactory } from '@/test-utils';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { AddReactionDto } from './dto/add-reaction.dto';
import { RemoveReactionDto } from './dto/remove-reaction.dto';
import { AddAttachmentDto } from './dto/add-attachment.dto';
import { ServerEvents } from '@semaphore-chat/shared';
import { LINK_PREVIEWS_QUEUE } from '@/jobs/jobs.constants';

describe('MessagesController', () => {
  let controller: MessagesController;
  let service: Mocked<MessagesService>;
  let reactionsService: Mocked<ReactionsService>;
  let websocketService: Mocked<WebsocketService>;
  let linkPreviewsQueue: Mocked<Queue>;

  const mockUser = UserFactory.build();
  const mockRequest = {
    user: { id: mockUser.id },
  } as any;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(MessagesController).compile();

    controller = unit;
    service = unitRef.get(MessagesService);
    reactionsService = unitRef.get(ReactionsService);
    websocketService = unitRef.get(WebsocketService);
    linkPreviewsQueue = unitRef.get(getQueueToken(LINK_PREVIEWS_QUEUE));
    (linkPreviewsQueue.add as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a message with author ID and timestamp', async () => {
      const createDto: CreateMessageDto = {
        channelId: 'channel-123',
        directMessageGroupId: null,
        spans: [
          {
            type: 'TEXT' as any,
            text: 'Hello world',
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
        attachments: [],
        pendingAttachments: 0,
        authorId: '',
        sentAt: new Date(),
        editedAt: null,
        deletedAt: null,
        id: '',
        searchText: null,
        pinned: false,
        pinnedAt: null,
        pinnedBy: null,
        deletedBy: null,
        deletedByReason: null,
        parentMessageId: null,
        replyCount: 0,
        lastReplyAt: null,
      } as any;

      const mockMessage = MessageFactory.build({
        channelId: createDto.channelId,
        authorId: mockUser.id,
      });

      const enrichedMessage = { ...mockMessage, attachments: [] };

      service.create.mockResolvedValue(mockMessage as any);
      service.enrichMessageWithFileMetadata.mockReturnValue(enrichedMessage);

      const result = await controller.create(mockRequest, createDto);

      expect(service.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: createDto.channelId,
          authorId: mockUser.id,
          sentAt: expect.any(Date),
        }),
      );
      expect(service.enrichMessageWithFileMetadata).toHaveBeenCalledWith(
        mockMessage,
      );
      expect(result).toEqual(enrichedMessage);
    });

    it('should set sentAt timestamp when creating message', async () => {
      const createDto: CreateMessageDto = {
        channelId: 'channel-123',
        directMessageGroupId: null,
        spans: [],
        attachments: [],
        pendingAttachments: 0,
        authorId: '',
        sentAt: new Date(),
        editedAt: null,
        deletedAt: null,
        id: '',
        searchText: null,
        pinned: false,
        pinnedAt: null,
        pinnedBy: null,
        deletedBy: null,
        deletedByReason: null,
        parentMessageId: null,
        replyCount: 0,
        lastReplyAt: null,
      };

      const mockMessage = {};
      service.create.mockResolvedValue(mockMessage as any);
      service.enrichMessageWithFileMetadata.mockReturnValue({
        attachments: [],
      });

      await controller.create(mockRequest, createDto);

      const call = (service.create as jest.Mock).mock.calls[0]?.[0];
      expect(call.sentAt).toBeInstanceOf(Date);
    });
  });

  describe('findAllForGroup', () => {
    it('should find messages for DM group with default limit', async () => {
      const groupId = 'group-123';
      const mockMessages = {
        messages: [MessageFactory.build(), MessageFactory.build()],
        continuationToken: undefined,
      };

      service.findAllForDirectMessageGroup.mockResolvedValue(
        mockMessages as any,
      );

      const result = await controller.findAllForGroup(groupId, 50);

      expect(service.findAllForDirectMessageGroup).toHaveBeenCalledWith(
        groupId,
        50,
        undefined,
        'older',
      );
      expect(result).toEqual(mockMessages);
    });

    it('should use custom limit and continuation token', async () => {
      const groupId = 'group-123';
      const limit = 25;
      const continuationToken = 'token-abc';

      service.findAllForDirectMessageGroup.mockResolvedValue({
        messages: [],
        continuationToken: undefined,
      });

      await controller.findAllForGroup(groupId, limit, continuationToken);

      expect(service.findAllForDirectMessageGroup).toHaveBeenCalledWith(
        groupId,
        25,
        continuationToken,
        'older',
      );
    });
  });

  describe('findAllForChannel', () => {
    it('should find messages for channel with default limit', async () => {
      const channelId = 'channel-123';
      const mockMessages = {
        messages: [MessageFactory.build()],
        continuationToken: 'next-token',
      };

      service.findAllForChannel.mockResolvedValue(mockMessages as any);

      const result = await controller.findAllForChannel(channelId, 50);

      expect(service.findAllForChannel).toHaveBeenCalledWith(
        channelId,
        50,
        undefined,
        'older',
      );
      expect(result).toEqual(mockMessages);
    });

    it('should use provided limit', async () => {
      const channelId = 'channel-123';

      service.findAllForChannel.mockResolvedValue({
        messages: [],
        continuationToken: undefined,
      });

      await controller.findAllForChannel(channelId, 100);

      expect(service.findAllForChannel).toHaveBeenCalledWith(
        channelId,
        100,
        undefined,
        'older',
      );
    });

    it('should pass limit=50 as-is without clamping', async () => {
      const channelId = 'channel-123';

      service.findAllForChannel.mockResolvedValue({
        messages: [],
        continuationToken: undefined,
      });

      await controller.findAllForChannel(channelId, 50);

      expect(service.findAllForChannel).toHaveBeenCalledWith(
        channelId,
        50,
        undefined,
        'older',
      );
    });

    it('should clamp limit=200 to 100', async () => {
      const channelId = 'channel-123';

      service.findAllForChannel.mockResolvedValue({
        messages: [],
        continuationToken: undefined,
      });

      await controller.findAllForChannel(channelId, 200);

      expect(service.findAllForChannel).toHaveBeenCalledWith(
        channelId,
        100,
        undefined,
        'older',
      );
    });

    it('should keep limit=100 unchanged', async () => {
      const channelId = 'channel-123';

      service.findAllForChannel.mockResolvedValue({
        messages: [],
        continuationToken: undefined,
      });

      await controller.findAllForChannel(channelId, 100);

      expect(service.findAllForChannel).toHaveBeenCalledWith(
        channelId,
        100,
        undefined,
        'older',
      );
    });
  });

  describe('addReaction', () => {
    it('should add reaction and emit WebSocket event for channel message', async () => {
      const addReactionDto: AddReactionDto = {
        messageId: 'msg-123',
        emoji: '👍',
      };

      const mockMessage = MessageFactory.build({
        id: 'msg-123',
        channelId: 'channel-123',
        reactions: [{ emoji: '👍', userId: mockUser.id }],
      } as any);

      reactionsService.addReaction.mockResolvedValue(mockMessage as any);

      const result = await controller.addReaction(addReactionDto, mockRequest);

      expect(reactionsService.addReaction).toHaveBeenCalledWith(
        'msg-123',
        '👍',
        mockUser.id,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'channel-123',
        ServerEvents.REACTION_ADDED,
        {
          messageId: 'msg-123',
          reaction: { emoji: '👍', userIds: [mockUser.id] },
          channelId: 'channel-123',
          directMessageGroupId: null,
          parentMessageId: null,
        },
      );
      expect(result).toEqual({
        ...mockMessage,
        reactions: [{ emoji: '👍', userIds: [mockUser.id] }],
      });
    });

    it('should add reaction and emit WebSocket event for DM message', async () => {
      const addReactionDto: AddReactionDto = {
        messageId: 'msg-456',
        emoji: '❤️',
      };

      const mockMessage = MessageFactory.build({
        id: 'msg-456',
        channelId: null,
        directMessageGroupId: 'dm-group-123',
        reactions: [{ emoji: '❤️', userId: mockUser.id }],
      } as any);

      reactionsService.addReaction.mockResolvedValue(mockMessage as any);

      await controller.addReaction(addReactionDto, mockRequest);

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'dm:dm-group-123',
        ServerEvents.REACTION_ADDED,
        expect.objectContaining({
          messageId: 'msg-456',
        }),
      );
    });

    it('should not emit WebSocket when no room ID exists', async () => {
      const addReactionDto: AddReactionDto = {
        messageId: 'msg-789',
        emoji: '🎉',
      };

      const mockMessage = MessageFactory.build({
        channelId: null,
        directMessageGroupId: null,
        reactions: [],
      } as any);

      reactionsService.addReaction.mockResolvedValue(mockMessage as any);

      await controller.addReaction(addReactionDto, mockRequest);

      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });
  });

  describe('removeReaction', () => {
    it('should remove reaction and emit WebSocket event', async () => {
      const removeReactionDto: RemoveReactionDto = {
        messageId: 'msg-123',
        emoji: '👍',
      };

      const mockMessage = MessageFactory.build({
        id: 'msg-123',
        channelId: 'channel-123',
        reactions: [],
      } as any);

      reactionsService.removeReaction.mockResolvedValue(mockMessage as any);

      const result = await controller.removeReaction(
        removeReactionDto,
        mockRequest,
      );

      expect(reactionsService.removeReaction).toHaveBeenCalledWith(
        'msg-123',
        '👍',
        mockUser.id,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'channel-123',
        ServerEvents.REACTION_REMOVED,
        {
          messageId: 'msg-123',
          emoji: '👍',
          reactions: [],
          channelId: 'channel-123',
          directMessageGroupId: null,
          parentMessageId: null,
        },
      );
      expect(result).toEqual({
        ...mockMessage,
        reactions: [],
      });
    });

    it('should handle DM group messages when removing reaction', async () => {
      const removeReactionDto: RemoveReactionDto = {
        messageId: 'msg-456',
        emoji: '❤️',
      };

      const mockMessage = MessageFactory.build({
        channelId: null,
        directMessageGroupId: 'dm-group-123',
        reactions: [],
      } as any);

      reactionsService.removeReaction.mockResolvedValue(mockMessage as any);

      await controller.removeReaction(removeReactionDto, mockRequest);

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'dm:dm-group-123',
        ServerEvents.REACTION_REMOVED,
        expect.any(Object),
      );
    });
  });

  describe('addAttachment', () => {
    it('should add attachment and emit update event with enriched message', async () => {
      const messageId = 'msg-123';
      const addAttachmentDto: AddAttachmentDto = {
        fileId: 'file-abc',
      };

      const originalMessage = MessageFactory.build({
        id: messageId,
        channelId: 'channel-123',
      });

      const updatedMessage = MessageFactory.build({
        ...originalMessage,
        attachments: ['file-abc'],
        pendingAttachments: 0,
      } as any);

      const enrichedMessage = { ...updatedMessage, fileMetadata: {} };

      service.findOne.mockResolvedValue(originalMessage as any);
      service.addAttachment.mockResolvedValue(updatedMessage as any);
      service.enrichMessageWithFileMetadata.mockReturnValue(
        enrichedMessage as any,
      );

      const result = await controller.addAttachment(
        messageId,
        addAttachmentDto,
      );

      expect(service.findOne).toHaveBeenCalledWith(messageId);
      expect(service.addAttachment).toHaveBeenCalledWith(messageId, 'file-abc');
      expect(service.enrichMessageWithFileMetadata).toHaveBeenCalledWith(
        updatedMessage,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'channel-123',
        ServerEvents.UPDATE_MESSAGE,
        { message: enrichedMessage },
      );
      expect(result).toEqual(enrichedMessage);
    });

    it('should handle failed upload by passing undefined fileId', async () => {
      const messageId = 'msg-123';
      const addAttachmentDto: AddAttachmentDto = {
        fileId: undefined,
      };

      const originalMessage = MessageFactory.build({
        channelId: 'channel-123',
      });
      const updatedMessage = MessageFactory.build({ pendingAttachments: 0 });

      service.findOne.mockResolvedValue(originalMessage as any);
      service.addAttachment.mockResolvedValue(updatedMessage as any);
      service.enrichMessageWithFileMetadata.mockReturnValue(
        updatedMessage as any,
      );

      await controller.addAttachment(messageId, addAttachmentDto);

      expect(service.addAttachment).toHaveBeenCalledWith(messageId, undefined);
    });
  });

  describe('findOne', () => {
    it('should return a single message by ID with enriched attachments', async () => {
      const messageId = 'msg-123';
      const mockMessage = MessageFactory.build({ id: messageId });
      const enrichedMessage = { ...mockMessage, attachments: [] };

      service.findOne.mockResolvedValue(mockMessage as any);
      service.enrichMessageWithFileMetadata.mockReturnValue(enrichedMessage);

      const result = await controller.findOne(messageId);

      expect(service.findOne).toHaveBeenCalledWith(messageId);
      expect(service.enrichMessageWithFileMetadata).toHaveBeenCalledWith(
        mockMessage,
      );
      expect(result).toEqual(enrichedMessage);
    });
  });

  describe('update', () => {
    it('should update message and emit WebSocket event with enriched message', async () => {
      const messageId = 'msg-123';
      const updateDto: UpdateMessageDto = {
        spans: [
          {
            type: 'TEXT' as any,
            text: 'Updated content',
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
            emojiId: null,
          },
        ],
      };

      const originalMessage = MessageFactory.build({
        id: messageId,
        channelId: 'channel-123',
        attachments: [{ id: 'old-file', filename: 'test.png' }],
      } as any);

      const updatedMessage = MessageFactory.build({
        id: messageId,
      });

      const enrichedMessage = { ...updatedMessage, attachments: [] };

      service.findOne.mockResolvedValue(originalMessage as any);
      service.update.mockResolvedValue(updatedMessage as any);
      service.enrichMessageWithFileMetadata.mockReturnValue(enrichedMessage);

      const result = await controller.update(messageId, updateDto);

      expect(service.findOne).toHaveBeenCalledWith(messageId);
      expect(service.update).toHaveBeenCalledWith(messageId, updateDto, [
        'old-file',
      ]);
      expect(service.enrichMessageWithFileMetadata).toHaveBeenCalledWith(
        updatedMessage,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'channel-123',
        ServerEvents.UPDATE_MESSAGE,
        { message: enrichedMessage },
      );
      expect(result).toEqual(enrichedMessage);

      // Edit path enqueues link-preview reprocessing with a jobId distinct
      // from the create-path job (`preview-${id}`, no suffix) in
      // MessageDispatchService — otherwise BullMQ's jobId dedupe could
      // swallow the edit's reprocessing as a duplicate of an
      // still-queued/active create job for the same message. `-` separators
      // because BullMQ rejects custom jobIds containing `:`.
      expect(linkPreviewsQueue.add).toHaveBeenCalledWith(
        'process',
        {
          messageId,
          room: 'channel-123',
          event: ServerEvents.UPDATE_MESSAGE,
        },
        {
          jobId: expect.stringMatching(
            new RegExp(`^preview-${messageId}-edit-`),
          ),
        },
      );
      const [, , options] = (linkPreviewsQueue.add as jest.Mock).mock.calls[0];
      expect(options.jobId).not.toBe(`preview-${messageId}`);
      expect(options.jobId).not.toContain(':');
    });

    it('does not enqueue link-preview reprocessing when the update has no spans', async () => {
      const messageId = 'msg-999';
      const updateDto: UpdateMessageDto = {};

      const originalMessage = MessageFactory.build({
        id: messageId,
        channelId: 'channel-123',
        attachments: [],
      } as any);
      const updatedMessage = MessageFactory.build({ id: messageId });
      const enrichedMessage = { ...updatedMessage, attachments: [] };

      service.findOne.mockResolvedValue(originalMessage as any);
      service.update.mockResolvedValue(updatedMessage as any);
      service.enrichMessageWithFileMetadata.mockReturnValue(enrichedMessage);

      await controller.update(messageId, updateDto);

      expect(linkPreviewsQueue.add).not.toHaveBeenCalled();
    });

    it('enqueues two edits of the same message with distinct jobIds', async () => {
      const messageId = 'msg-777';
      const updateDto: UpdateMessageDto = { spans: [] };

      const originalMessage = MessageFactory.build({
        id: messageId,
        channelId: 'channel-123',
        attachments: [],
      } as any);
      const updatedMessage = MessageFactory.build({ id: messageId });

      service.findOne.mockResolvedValue(originalMessage as any);
      service.update.mockResolvedValue(updatedMessage as any);
      service.enrichMessageWithFileMetadata.mockReturnValue({
        ...updatedMessage,
        attachments: [],
      });

      await controller.update(messageId, updateDto);
      await controller.update(messageId, updateDto);

      const jobIds = (linkPreviewsQueue.add as jest.Mock).mock.calls.map(
        (call) => call[2].jobId,
      );
      expect(jobIds).toHaveLength(2);
      expect(jobIds[0]).not.toBe(jobIds[1]);
    });

    it('logs and swallows an enqueue failure without failing the request', async () => {
      const messageId = 'msg-321';
      const updateDto: UpdateMessageDto = { spans: [] };

      const originalMessage = MessageFactory.build({
        id: messageId,
        channelId: 'channel-123',
        attachments: [],
      } as any);
      const updatedMessage = MessageFactory.build({ id: messageId });
      const enrichedMessage = { ...updatedMessage, attachments: [] };

      service.findOne.mockResolvedValue(originalMessage as any);
      service.update.mockResolvedValue(updatedMessage as any);
      service.enrichMessageWithFileMetadata.mockReturnValue(enrichedMessage);
      (linkPreviewsQueue.add as jest.Mock).mockRejectedValue(
        new Error('redis boom'),
      );
      const warnSpy = jest
        .spyOn(controller['logger'], 'warn')
        .mockImplementation(() => undefined);

      const result = await controller.update(messageId, updateDto);

      expect(result).toEqual(enrichedMessage);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to enqueue link preview processing on edit',
        expect.any(Error),
      );
    });

    it('should handle DM group message updates', async () => {
      const messageId = 'msg-456';
      const updateDto: UpdateMessageDto = {
        spans: [],
      };

      const originalMessage = MessageFactory.build({
        channelId: null,
        directMessageGroupId: 'dm-group-123',
        attachments: [],
      } as any);

      const updatedMessage = MessageFactory.build();
      const enrichedMessage = { ...updatedMessage, attachments: [] };

      service.findOne.mockResolvedValue(originalMessage as any);
      service.update.mockResolvedValue(updatedMessage as any);
      service.enrichMessageWithFileMetadata.mockReturnValue(enrichedMessage);

      await controller.update(messageId, updateDto);

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'dm:dm-group-123',
        ServerEvents.UPDATE_MESSAGE,
        { message: enrichedMessage },
      );
    });
  });

  describe('remove', () => {
    it('should delete message and emit WebSocket event', async () => {
      const messageId = 'msg-123';
      const mockMessage = MessageFactory.build({
        id: messageId,
        channelId: 'channel-123',
        attachments: ['file-1', 'file-2'],
      } as any);

      service.findOne.mockResolvedValue(mockMessage as any);
      service.remove.mockResolvedValue(void 0 as any);

      await controller.remove(messageId);

      expect(service.findOne).toHaveBeenCalledWith(messageId);
      expect(service.remove).toHaveBeenCalledWith(messageId);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'channel-123',
        ServerEvents.DELETE_MESSAGE,
        {
          messageId,
          channelId: 'channel-123',
          directMessageGroupId: mockMessage.directMessageGroupId,
        },
      );
    });

    it('should delete DM message and emit to DM group', async () => {
      const messageId = 'msg-456';
      const mockMessage = MessageFactory.build({
        id: messageId,
        channelId: null,
        directMessageGroupId: 'dm-group-123',
        attachments: [],
      } as any);

      service.findOne.mockResolvedValue(mockMessage as any);
      service.remove.mockResolvedValue(void 0 as any);

      await controller.remove(messageId);

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'dm:dm-group-123',
        ServerEvents.DELETE_MESSAGE,
        expect.objectContaining({
          messageId,
          directMessageGroupId: 'dm-group-123',
        }),
      );
    });

    it('should call remove with just the message ID', async () => {
      const messageId = 'msg-789';
      const mockMessage = MessageFactory.build({
        channelId: 'channel-123',
      });

      service.findOne.mockResolvedValue(mockMessage as any);
      service.remove.mockResolvedValue(void 0 as any);

      await controller.remove(messageId);

      expect(service.remove).toHaveBeenCalledWith(messageId);
    });
  });
});
