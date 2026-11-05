import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ServerEvents } from '@semaphore-chat/shared';
import { ModerationService } from '@/moderation/moderation.service';
import { ReadReceiptsService } from '@/read-receipts/read-receipts.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { MessageDispatchService } from './message-dispatch.service';
import { MessageSendService } from './message-send.service';
import { MessagesService } from './messages.service';

describe('MessageSendService', () => {
  let service: MessageSendService;
  let messagesService: Mocked<MessagesService>;
  let dispatch: Mocked<MessageDispatchService>;
  let moderation: Mocked<ModerationService>;
  let readReceipts: Mocked<ReadReceiptsService>;
  let websocket: Mocked<WebsocketService>;

  const receipt = {
    channelId: 'channel-1',
    directMessageGroupId: null,
    lastReadMessageId: 'msg-1',
    lastReadAt: new Date(),
  };

  /** The receipt is deliberately not awaited by the send. */
  const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(MessageSendService).compile();
    service = unit;
    messagesService = unitRef.get(MessagesService);
    dispatch = unitRef.get(MessageDispatchService);
    moderation = unitRef.get(ModerationService);
    readReceipts = unitRef.get(ReadReceiptsService);
    websocket = unitRef.get(WebsocketService);

    messagesService.create.mockResolvedValue({ id: 'msg-1' } as any);
    messagesService.checkSlowmode.mockResolvedValue(undefined);
    moderation.getCommunityIdFromChannel.mockResolvedValue('community-1');
    moderation.isUserTimedOut.mockResolvedValue({ isTimedOut: false });
    dispatch.dispatch.mockResolvedValue(undefined);
    readReceipts.markAsRead.mockResolvedValue(receipt as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendToChannel', () => {
    const dto = { channelId: 'channel-1', spans: [], attachments: [] } as any;

    it('writes the message as the sender and broadcasts it', async () => {
      await expect(service.sendToChannel('user-1', dto)).resolves.toEqual({
        id: 'msg-1',
      });

      expect(messagesService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-1',
          authorId: 'user-1',
          sentAt: expect.any(Date),
        }),
      );
      expect(dispatch.dispatch).toHaveBeenCalledWith(
        { id: 'msg-1' },
        {
          room: 'channel-1',
          event: ServerEvents.NEW_MESSAGE,
          notifications: true,
          linkPreviews: true,
        },
      );
    });

    it('marks the message read for the sender', async () => {
      await service.sendToChannel('user-1', dto);
      await flushPromises();

      expect(readReceipts.markAsRead).toHaveBeenCalledWith('user-1', {
        lastReadMessageId: 'msg-1',
        channelId: 'channel-1',
      });
      expect(websocket.sendToRoom).toHaveBeenCalledWith(
        'user:user-1',
        ServerEvents.READ_RECEIPT_UPDATED,
        expect.objectContaining({ lastReadMessageId: 'msg-1' }),
      );
    });

    it('a failed read receipt does not fail the send', async () => {
      readReceipts.markAsRead.mockRejectedValue(new Error('nope'));

      await expect(service.sendToChannel('user-1', dto)).resolves.toEqual({
        id: 'msg-1',
      });
      await flushPromises();
    });

    it('requires a channel', async () => {
      await expect(
        service.sendToChannel('user-1', { spans: [] } as any),
      ).rejects.toThrow(BadRequestException);
      expect(messagesService.create).not.toHaveBeenCalled();
    });

    it('rejects a timed-out sender with the time remaining', async () => {
      moderation.isUserTimedOut.mockResolvedValue({
        isTimedOut: true,
        expiresAt: new Date(Date.now() + 30_000),
      });

      const send = service.sendToChannel('user-1', dto);

      await expect(send).rejects.toThrow(ForbiddenException);
      await expect(send).rejects.toThrow(/Time remaining: 30 seconds/);
      expect(messagesService.create).not.toHaveBeenCalled();
    });

    it('stops at slowmode', async () => {
      messagesService.checkSlowmode.mockRejectedValue(
        new ForbiddenException('Slowmode is enabled'),
      );

      await expect(service.sendToChannel('user-1', dto)).rejects.toThrow(
        'Slowmode is enabled',
      );
      expect(messagesService.create).not.toHaveBeenCalled();
      expect(dispatch.dispatch).not.toHaveBeenCalled();
    });

    it('does not broadcast a message that failed to write', async () => {
      messagesService.create.mockRejectedValue(new BadRequestException());

      await expect(service.sendToChannel('user-1', dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(dispatch.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('sendToDirectMessageGroup', () => {
    const dto = {
      directMessageGroupId: 'group-1',
      spans: [],
      attachments: [],
    } as any;

    it('writes the message and broadcasts it to the group', async () => {
      await service.sendToDirectMessageGroup('user-1', dto);

      expect(messagesService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          directMessageGroupId: 'group-1',
          authorId: 'user-1',
        }),
      );
      expect(dispatch.dispatch).toHaveBeenCalledWith(
        { id: 'msg-1' },
        {
          room: 'dm:group-1',
          event: ServerEvents.NEW_DM,
          notifications: true,
          linkPreviews: true,
        },
      );
    });

    it('marks the message read for the sender', async () => {
      await service.sendToDirectMessageGroup('user-1', dto);
      await flushPromises();

      expect(readReceipts.markAsRead).toHaveBeenCalledWith('user-1', {
        lastReadMessageId: 'msg-1',
        directMessageGroupId: 'group-1',
      });
    });

    it('has no channel checks', async () => {
      await service.sendToDirectMessageGroup('user-1', dto);

      expect(moderation.isUserTimedOut).not.toHaveBeenCalled();
      expect(messagesService.checkSlowmode).not.toHaveBeenCalled();
    });

    it('requires a group', async () => {
      await expect(
        service.sendToDirectMessageGroup('user-1', { spans: [] } as any),
      ).rejects.toThrow(BadRequestException);
      expect(messagesService.create).not.toHaveBeenCalled();
    });
  });
});
