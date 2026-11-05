import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ThreadsGateway } from './threads.gateway';
import { ThreadsService } from './threads.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { DatabaseService } from '@/database/database.service';
import { LinkPreviewsService } from '@/link-previews/link-previews.service';
import { WsException } from '@nestjs/websockets';
import { ServerEvents } from '@semaphore-chat/shared';

describe('ThreadsGateway', () => {
  let gateway: ThreadsGateway;
  let threadsService: Mocked<ThreadsService>;
  let websocketService: Mocked<WebsocketService>;
  let notificationsService: Mocked<NotificationsService>;
  let databaseService: Mocked<DatabaseService>;
  let linkPreviewsService: Mocked<LinkPreviewsService>;

  const mockClient = {
    id: 'socket-1',
    handshake: { user: { id: 'user-1', username: 'alice' } },
  } as any;

  const basePayload = {
    parentMessageId: 'parent-msg-1',
    spans: [
      {
        type: 'PLAINTEXT',
        text: 'hello',
        userId: null,
        specialKind: null,
        communityId: null,
        aliasId: null,
      },
    ],
  };

  const mockReply = {
    id: 'reply-1',
    authorId: 'user-1',
    parentMessageId: 'parent-msg-1',
    spans: basePayload.spans,
    createdAt: new Date(),
  };

  const mockParentMessage = {
    channelId: 'ch-1',
    directMessageGroupId: null,
    replyCount: 3,
    lastReplyAt: new Date(),
  };

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(ThreadsGateway).compile();

    gateway = unit;
    threadsService = unitRef.get(ThreadsService);
    websocketService = unitRef.get(WebsocketService);
    notificationsService = unitRef.get(NotificationsService);
    databaseService = unitRef.get(DatabaseService);
    linkPreviewsService = unitRef.get(LinkPreviewsService);

    threadsService.sendThreadReply = jest
      .fn()
      .mockResolvedValue({ reply: mockReply, created: true });
    (databaseService.message as any) = {
      findUnique: jest.fn().mockResolvedValue(mockParentMessage),
    };
    notificationsService.processThreadReplyNotifications = jest
      .fn()
      .mockResolvedValue(undefined);
    linkPreviewsService.processMessageLinkPreviews = jest
      .fn()
      .mockResolvedValue(undefined);
    websocketService.sendToRoom = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleThreadReply', () => {
    it('does not announce a retry again', async () => {
      threadsService.sendThreadReply = jest
        .fn()
        .mockResolvedValue({ reply: mockReply, created: false });

      await expect(
        gateway.handleThreadReply(basePayload as any, mockClient),
      ).resolves.toBe(mockReply.id);

      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('creates a reply through the threads service', async () => {
      await gateway.handleThreadReply(basePayload as any, mockClient);

      expect(threadsService.sendThreadReply).toHaveBeenCalledWith(
        expect.objectContaining({
          parentMessageId: 'parent-msg-1',
          spans: basePayload.spans,
        }),
        'user-1',
      );
    });

    it('broadcasts NEW_THREAD_REPLY to the parent message room', async () => {
      await gateway.handleThreadReply(basePayload as any, mockClient);

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'ch-1',
        ServerEvents.NEW_THREAD_REPLY,
        expect.objectContaining({
          reply: mockReply,
          parentMessageId: 'parent-msg-1',
        }),
      );
    });

    it('broadcasts THREAD_REPLY_COUNT_UPDATED with correct counts', async () => {
      await gateway.handleThreadReply(basePayload as any, mockClient);

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'ch-1',
        ServerEvents.THREAD_REPLY_COUNT_UPDATED,
        expect.objectContaining({
          parentMessageId: 'parent-msg-1',
          replyCount: 3,
          lastReplyAt: mockParentMessage.lastReplyAt.toISOString(),
          channelId: 'ch-1',
          directMessageGroupId: null,
        }),
      );
    });

    it('uses directMessageGroupId as room when channelId is null', async () => {
      (databaseService.message as any).findUnique.mockResolvedValue({
        channelId: null,
        directMessageGroupId: 'dm-1',
        replyCount: 1,
        lastReplyAt: new Date(),
      });

      await gateway.handleThreadReply(basePayload as any, mockClient);

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'dm:dm-1',
        ServerEvents.NEW_THREAD_REPLY,
        expect.any(Object),
      );
    });

    it('fires notification processing asynchronously (non-blocking)', async () => {
      await gateway.handleThreadReply(basePayload as any, mockClient);

      expect(
        notificationsService.processThreadReplyNotifications,
      ).toHaveBeenCalledWith(mockReply, 'parent-msg-1', 'user-1');
    });

    it('does not block the response if notification processing fails', async () => {
      notificationsService.processThreadReplyNotifications = jest
        .fn()
        .mockRejectedValue(new Error('notification failure'));

      // Should resolve without throwing — notification failure is swallowed
      const result = await gateway.handleThreadReply(
        basePayload as any,
        mockClient,
      );
      expect(result).toBe('reply-1');
    });

    it('returns the reply ID on success', async () => {
      const result = await gateway.handleThreadReply(
        basePayload as any,
        mockClient,
      );

      expect(result).toBe('reply-1');
    });

    it('throws WsException when parentMessageId is missing', async () => {
      const payloadWithoutParent = { ...basePayload, parentMessageId: '' };

      await expect(
        gateway.handleThreadReply(payloadWithoutParent as any, mockClient),
      ).rejects.toThrow(WsException);
    });

    it('throws WsException when parent message is not found', async () => {
      (databaseService.message as any).findUnique.mockResolvedValue(null);

      await expect(
        gateway.handleThreadReply(basePayload as any, mockClient),
      ).rejects.toThrow(WsException);
    });

    it('does not broadcast when roomId is null (orphaned parent)', async () => {
      (databaseService.message as any).findUnique.mockResolvedValue({
        channelId: null,
        directMessageGroupId: null,
        replyCount: 1,
        lastReplyAt: new Date(),
      });

      await gateway.handleThreadReply(basePayload as any, mockClient);

      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('passes attachments and pendingAttachments to the service', async () => {
      const payloadWithAttachments = {
        ...basePayload,
        attachments: ['att-1', 'att-2'],
        pendingAttachments: 1,
      };

      await gateway.handleThreadReply(
        payloadWithAttachments as any,
        mockClient,
      );

      expect(threadsService.sendThreadReply).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: ['att-1', 'att-2'],
          pendingAttachments: 1,
        }),
        'user-1',
      );
    });
  });

  describe('lifecycle', () => {
    it('afterInit should not throw', () => {
      expect(() => gateway.afterInit({} as any)).not.toThrow();
    });

    it('handleConnection should not throw', () => {
      expect(() =>
        gateway.handleConnection({ id: 'test' } as any),
      ).not.toThrow();
    });

    it('handleDisconnect should not throw', () => {
      expect(() =>
        gateway.handleDisconnect({ id: 'test' } as any),
      ).not.toThrow();
    });
  });
});
