import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { MessageDispatchService } from './message-dispatch.service';
import { MessagesService } from './messages.service';
import { WebsocketService } from '@/websocket/websocket.service';
import {
  MESSAGE_FANOUT_QUEUE,
  LINK_PREVIEWS_QUEUE,
} from '@/jobs/jobs.constants';
import { ServerEvents } from '@semaphore-chat/shared';

describe('MessageDispatchService', () => {
  let service: MessageDispatchService;
  let messagesService: Mocked<MessagesService>;
  let websocketService: Mocked<WebsocketService>;
  let messageFanoutQueue: Mocked<Queue>;
  let linkPreviewsQueue: Mocked<Queue>;

  const rawMessage = {
    id: 'msg-1',
    channelId: 'channel-1',
    spans: [{ type: 'PLAINTEXT', text: 'hello' }],
    attachments: [],
  };
  const enrichedMessage = { ...rawMessage, attachments: [] };

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      MessageDispatchService,
    ).compile();

    service = unit;
    messagesService = unitRef.get(MessagesService);
    websocketService = unitRef.get(WebsocketService);
    messageFanoutQueue = unitRef.get(getQueueToken(MESSAGE_FANOUT_QUEUE));
    linkPreviewsQueue = unitRef.get(getQueueToken(LINK_PREVIEWS_QUEUE));

    messagesService.enrichMessageWithFileMetadata.mockReturnValue(
      enrichedMessage,
    );
    (messageFanoutQueue.add as jest.Mock).mockResolvedValue(undefined);
    (linkPreviewsQueue.add as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('enriches the message before broadcasting it', async () => {
    const callOrder: string[] = [];
    messagesService.enrichMessageWithFileMetadata.mockImplementation((m) => {
      callOrder.push('enrich');
      return { ...(m as any), attachments: [] };
    });
    websocketService.sendToRoom.mockImplementation(() => {
      callOrder.push('sendToRoom');
      return true;
    });

    await service.dispatch(rawMessage as any, {
      room: 'channel-1',
      event: ServerEvents.NEW_MESSAGE,
      notifications: false,
      linkPreviews: false,
    });

    expect(callOrder).toEqual(['enrich', 'sendToRoom']);
  });

  it('broadcasts the enriched message to the given room/event', async () => {
    await service.dispatch(rawMessage as any, {
      room: 'channel-1',
      event: ServerEvents.NEW_MESSAGE,
      notifications: false,
      linkPreviews: false,
    });

    expect(messagesService.enrichMessageWithFileMetadata).toHaveBeenCalledWith(
      rawMessage,
    );
    expect(websocketService.sendToRoom).toHaveBeenCalledWith(
      'channel-1',
      ServerEvents.NEW_MESSAGE,
      { message: enrichedMessage },
    );
  });

  it('broadcasts NEW_DM to the dm room when configured', async () => {
    await service.dispatch(rawMessage as any, {
      room: 'dm:group-1',
      event: ServerEvents.NEW_DM,
      notifications: false,
      linkPreviews: false,
    });

    expect(websocketService.sendToRoom).toHaveBeenCalledWith(
      'dm:group-1',
      ServerEvents.NEW_DM,
      { message: enrichedMessage },
    );
  });

  it('enqueues a message-fanout job with an idempotent jobId when notifications: true', async () => {
    await service.dispatch(rawMessage as any, {
      room: 'channel-1',
      event: ServerEvents.NEW_MESSAGE,
      notifications: true,
      linkPreviews: false,
    });

    // `-` separator (not `:`): BullMQ rejects custom jobIds containing `:`.
    expect(messageFanoutQueue.add).toHaveBeenCalledWith(
      'fanout',
      { messageId: rawMessage.id },
      { jobId: `fanout-${rawMessage.id}` },
    );
  });

  it('skips the message-fanout enqueue when notifications: false (webhook path)', async () => {
    await service.dispatch(rawMessage as any, {
      room: 'channel-1',
      event: ServerEvents.NEW_MESSAGE,
      notifications: false,
      linkPreviews: false,
    });

    expect(messageFanoutQueue.add).not.toHaveBeenCalled();
  });

  it('enqueues a link-previews job using the dispatch room, always as UPDATE_MESSAGE', async () => {
    await service.dispatch(rawMessage as any, {
      room: 'dm:group-1',
      event: ServerEvents.NEW_DM,
      notifications: false,
      linkPreviews: true,
    });

    expect(linkPreviewsQueue.add).toHaveBeenCalledWith(
      'process',
      {
        messageId: rawMessage.id,
        room: 'dm:group-1',
        event: ServerEvents.UPDATE_MESSAGE,
      },
      { jobId: `preview-${rawMessage.id}` },
    );
  });

  it('skips the link-previews enqueue when linkPreviews: false', async () => {
    await service.dispatch(rawMessage as any, {
      room: 'channel-1',
      event: ServerEvents.NEW_MESSAGE,
      notifications: false,
      linkPreviews: false,
    });

    expect(linkPreviewsQueue.add).not.toHaveBeenCalled();
  });

  it('catches and logs a rejected message-fanout enqueue without throwing', async () => {
    const error = new Error('redis boom');
    (messageFanoutQueue.add as jest.Mock).mockRejectedValue(error);
    const errorSpy = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(
      service.dispatch(rawMessage as any, {
        room: 'channel-1',
        event: ServerEvents.NEW_MESSAGE,
        notifications: true,
        linkPreviews: false,
      }),
    ).resolves.toBeUndefined();

    // dispatch() no longer awaits the enqueue, so let the fire-and-forget
    // call's internal catch run before asserting on it.
    await new Promise((resolve) => setImmediate(resolve));

    expect(errorSpy).toHaveBeenCalledWith(
      `Failed to enqueue notification fan-out for message ${rawMessage.id}`,
      error,
    );
  });

  it('catches and logs a rejected link-previews enqueue without throwing', async () => {
    const error = new Error('redis boom');
    (linkPreviewsQueue.add as jest.Mock).mockRejectedValue(error);
    const errorSpy = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(
      service.dispatch(rawMessage as any, {
        room: 'channel-1',
        event: ServerEvents.NEW_MESSAGE,
        notifications: false,
        linkPreviews: true,
      }),
    ).resolves.toBeUndefined();

    // dispatch() no longer awaits the enqueue, so let the fire-and-forget
    // call's internal catch run before asserting on it.
    await new Promise((resolve) => setImmediate(resolve));

    expect(errorSpy).toHaveBeenCalledWith(
      `Failed to enqueue link preview processing for message ${rawMessage.id}`,
      error,
    );
  });

  it('resolves without waiting on the enqueue promises (fire-and-forget ack latency)', async () => {
    // Simulate a hung/never-resolving Redis call — if dispatch() awaited
    // either enqueue, this test would time out.
    (messageFanoutQueue.add as jest.Mock).mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    );
    (linkPreviewsQueue.add as jest.Mock).mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    );

    await expect(
      service.dispatch(rawMessage as any, {
        room: 'channel-1',
        event: ServerEvents.NEW_MESSAGE,
        notifications: true,
        linkPreviews: true,
      }),
    ).resolves.toBeUndefined();

    // The calls were still made synchronously — just not awaited.
    expect(messageFanoutQueue.add).toHaveBeenCalled();
    expect(linkPreviewsQueue.add).toHaveBeenCalled();
  });
});
