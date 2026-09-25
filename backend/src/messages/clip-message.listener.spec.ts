import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ClipMessageListener } from './clip-message.listener';
import { MessagesService } from './messages.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { ServerEvents } from '@semaphore-chat/shared';
import { ClipMessageCreateEvent } from '@/common/events/clip-message.events';

describe('ClipMessageListener', () => {
  let listener: ClipMessageListener;
  let messagesService: Mocked<MessagesService>;
  let websocketService: Mocked<WebsocketService>;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(ClipMessageListener).compile();

    listener = unit;
    messagesService = unitRef.get(MessagesService);
    websocketService = unitRef.get(WebsocketService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(listener).toBeDefined();
  });

  it('registers the handler with suppressErrors: false so create failures propagate to the emitter', () => {
    // The whole error contract hinges on this option: with the default
    // (suppressErrors: true) a listener exception is swallowed and emitAsync
    // resolves to [undefined] instead of rejecting with the original error.
    const metadata: Array<{
      event: string;
      options?: Record<string, unknown>;
    }> = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      ClipMessageListener.prototype.handleClipMessageCreate,
    );

    expect(metadata).toEqual([
      expect.objectContaining({
        options: { suppressErrors: false },
      }),
    ]);
  });

  describe('handleClipMessageCreate', () => {
    const channelEvent: ClipMessageCreateEvent = {
      authorId: 'user-123',
      fileId: 'file-1',
      durationSeconds: 60,
      sizeMB: 10,
      destination: 'channel',
      targetChannelId: 'channel-1',
    };

    const dmEvent: ClipMessageCreateEvent = {
      authorId: 'user-123',
      fileId: 'file-2',
      durationSeconds: 30,
      sizeMB: 5,
      destination: 'dm',
      targetDirectMessageGroupId: 'dm-group-1',
    };

    it('should create a message with clip text span and attachment for a channel', async () => {
      const message = { id: 'message-1', attachments: ['file-1'] };
      messagesService.create.mockResolvedValue(message as any);
      messagesService.enrichMessageWithFileMetadata.mockReturnValue(message);

      await listener.handleClipMessageCreate(channelEvent);

      expect(messagesService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-1',
          directMessageGroupId: null,
          authorId: 'user-123',
          attachments: ['file-1'],
          spans: [
            expect.objectContaining({
              type: 'PLAINTEXT',
              text: 'Replay clip - 60s (10MB)',
            }),
          ],
        }),
      );
    });

    it('should enrich the message and broadcast NEW_MESSAGE to the channel room', async () => {
      const message = { id: 'message-1', attachments: ['file-1'] };
      const enriched = {
        ...message,
        attachmentMetadata: [{ id: 'file-1', filename: 'clip.mp4' }],
      };
      messagesService.create.mockResolvedValue(message as any);
      messagesService.enrichMessageWithFileMetadata.mockReturnValue(enriched);

      await listener.handleClipMessageCreate(channelEvent);

      expect(
        messagesService.enrichMessageWithFileMetadata,
      ).toHaveBeenCalledWith(message);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'channel-1',
        ServerEvents.NEW_MESSAGE,
        { message: enriched },
      );
    });

    it('should create a DM message and broadcast NEW_DM to the DM group room', async () => {
      const message = { id: 'message-2', attachments: ['file-2'] };
      messagesService.create.mockResolvedValue(message as any);
      messagesService.enrichMessageWithFileMetadata.mockReturnValue(message);

      await listener.handleClipMessageCreate(dmEvent);

      expect(messagesService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: null,
          directMessageGroupId: 'dm-group-1',
          authorId: 'user-123',
          attachments: ['file-2'],
          spans: [
            expect.objectContaining({
              type: 'PLAINTEXT',
              text: 'Replay clip - 30s (5MB)',
            }),
          ],
        }),
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'dm:dm-group-1',
        ServerEvents.NEW_DM,
        { message: message },
      );
    });

    it('should return the created message id', async () => {
      const message = { id: 'message-1', attachments: ['file-1'] };
      messagesService.create.mockResolvedValue(message as any);
      messagesService.enrichMessageWithFileMetadata.mockReturnValue(message);

      const result = await listener.handleClipMessageCreate(channelEvent);

      expect(result).toEqual({ messageId: 'message-1' });
    });

    it('should propagate errors from message creation', async () => {
      messagesService.create.mockRejectedValue(new Error('DB error'));

      await expect(
        listener.handleClipMessageCreate(channelEvent),
      ).rejects.toThrow('DB error');
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });
  });
});
