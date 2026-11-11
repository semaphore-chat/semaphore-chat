import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { LinkPreviewsService } from './link-previews.service';
import { DatabaseService } from '@/database/database.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { createMockDatabase, MessageFactory } from '@/test-utils';
import * as linkPreviewUtils from './link-preview.utils';
import { ServerEvents } from '@semaphore-chat/shared';

jest.mock('./link-preview.utils', () => {
  const actual = jest.requireActual('./link-preview.utils');
  return {
    ...actual,
    fetchLinkMetadata: jest.fn(),
  };
});

const mockFetchLinkMetadata =
  linkPreviewUtils.fetchLinkMetadata as jest.MockedFunction<
    typeof linkPreviewUtils.fetchLinkMetadata
  >;

describe('LinkPreviewsService', () => {
  let service: LinkPreviewsService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let websocketService: Mocked<WebsocketService>;

  const messageId = 'msg-001';
  const roomId = 'room-abc';
  const serverEvent = ServerEvents.UPDATE_MESSAGE;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(LinkPreviewsService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    websocketService = unitRef.get(WebsocketService);

    mockFetchLinkMetadata.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processMessageLinkPreviews', () => {
    it('should return early when spans have no text', async () => {
      await service.processMessageLinkPreviews(
        messageId,
        [],
        roomId,
        serverEvent,
      );

      expect(mockDatabase.message.findUnique).not.toHaveBeenCalled();
      expect(mockDatabase.message.update).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('should return early when spans contain only null/empty text', async () => {
      const spans = [{ text: null }, { text: '' }];
      await service.processMessageLinkPreviews(
        messageId,
        spans,
        roomId,
        serverEvent,
      );

      expect(mockDatabase.message.findUnique).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('should not fetch or broadcast when text has no URLs and no stale previews', async () => {
      mockDatabase.message.findUnique.mockResolvedValue({ linkPreviews: null });

      const spans = [{ text: 'Hello world, no links here!' }];
      await service.processMessageLinkPreviews(
        messageId,
        spans,
        roomId,
        serverEvent,
      );

      expect(mockFetchLinkMetadata).not.toHaveBeenCalled();
      expect(mockDatabase.message.update).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('should not broadcast a removed message when clearing its previews', async () => {
      mockDatabase.message.findUnique.mockResolvedValue({
        linkPreviews: [{ url: 'https://old.example' }],
        deletedAt: new Date(),
      });

      await service.processMessageLinkPreviews(
        messageId,
        [{ text: 'edited, no links' }],
        roomId,
        serverEvent,
      );

      expect(mockDatabase.message.update).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('should not broadcast a message removed while its previews were stored', async () => {
      mockFetchLinkMetadata.mockResolvedValue({
        url: 'https://example.com',
        title: 'Example',
      });
      mockDatabase.message.findUnique
        .mockResolvedValueOnce({ id: messageId, deletedAt: null })
        .mockResolvedValueOnce({
          id: messageId,
          deletedAt: new Date(),
          spans: [],
          reactions: [],
          attachments: [],
        });

      await service.processMessageLinkPreviews(
        messageId,
        [{ text: 'see https://example.com' }],
        roomId,
        serverEvent,
      );

      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('should return early when all URL fetches fail', async () => {
      mockFetchLinkMetadata.mockResolvedValue(null);

      const spans = [{ text: 'Check https://fail1.com and https://fail2.com' }];
      await service.processMessageLinkPreviews(
        messageId,
        spans,
        roomId,
        serverEvent,
      );

      expect(mockFetchLinkMetadata).toHaveBeenCalledTimes(2);
      expect(mockDatabase.message.findUnique).not.toHaveBeenCalled();
      expect(mockDatabase.message.update).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('should return early when fetchLinkMetadata throws', async () => {
      mockFetchLinkMetadata.mockRejectedValue(new Error('network error'));

      const spans = [{ text: 'See https://error.com' }];
      await service.processMessageLinkPreviews(
        messageId,
        spans,
        roomId,
        serverEvent,
      );

      expect(mockFetchLinkMetadata).toHaveBeenCalledTimes(1);
      expect(mockDatabase.message.update).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('should skip deleted messages', async () => {
      const preview: linkPreviewUtils.LinkPreviewData = {
        url: 'https://example.com',
        title: 'Example',
      };
      mockFetchLinkMetadata.mockResolvedValue(preview);

      mockDatabase.message.findUnique.mockResolvedValueOnce({
        id: messageId,
        deletedAt: new Date(),
      });

      const spans = [{ text: 'Visit https://example.com' }];
      await service.processMessageLinkPreviews(
        messageId,
        spans,
        roomId,
        serverEvent,
      );

      expect(mockDatabase.message.findUnique).toHaveBeenCalledWith({
        where: { id: messageId },
        select: { id: true, deletedAt: true },
      });
      expect(mockDatabase.message.update).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('should skip when message no longer exists', async () => {
      const preview: linkPreviewUtils.LinkPreviewData = {
        url: 'https://example.com',
        title: 'Example',
      };
      mockFetchLinkMetadata.mockResolvedValue(preview);

      mockDatabase.message.findUnique.mockResolvedValueOnce(null);

      const spans = [{ text: 'Visit https://example.com' }];
      await service.processMessageLinkPreviews(
        messageId,
        spans,
        roomId,
        serverEvent,
      );

      expect(mockDatabase.message.update).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('should update DB and emit when previews are fetched successfully', async () => {
      const preview: linkPreviewUtils.LinkPreviewData = {
        url: 'https://example.com',
        title: 'Example Site',
        description: 'An example page',
      };
      mockFetchLinkMetadata.mockResolvedValue(preview);

      // First findUnique: existence check (message is not deleted)
      mockDatabase.message.findUnique.mockResolvedValueOnce({
        id: messageId,
        deletedAt: null,
      });

      // update succeeds
      mockDatabase.message.update.mockResolvedValue({});

      // Second findUnique: re-read with includes for broadcast
      const updatedMessage = {
        ...MessageFactory.build(),
        id: messageId,
        channelId: 'ch-1',
        authorId: 'user-1',
        content: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        linkPreviews: [preview],
        spans: [
          {
            id: 's1',
            messageId,
            position: 0,
            text: 'Visit https://example.com',
          },
        ],
        reactions: [],
        attachments: [],
      };
      mockDatabase.message.findUnique.mockResolvedValueOnce(updatedMessage);

      const spans = [{ text: 'Visit https://example.com' }];
      await service.processMessageLinkPreviews(
        messageId,
        spans,
        roomId,
        serverEvent,
      );

      // Verify DB update with previews
      expect(mockDatabase.message.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: { linkPreviews: [preview] },
      });

      // Verify websocket emission
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        roomId,
        serverEvent,
        expect.objectContaining({
          message: expect.objectContaining({
            id: messageId,
            linkPreviews: [preview],
          }),
        }),
      );
    });

    it('should collect only successful previews from multiple URLs', async () => {
      const successPreview: linkPreviewUtils.LinkPreviewData = {
        url: 'https://good.com',
        title: 'Good Site',
      };
      // First URL succeeds, second fails
      mockFetchLinkMetadata
        .mockResolvedValueOnce(successPreview)
        .mockResolvedValueOnce(null);

      mockDatabase.message.findUnique.mockResolvedValueOnce({
        id: messageId,
        deletedAt: null,
      });
      mockDatabase.message.update.mockResolvedValue({});
      mockDatabase.message.findUnique.mockResolvedValueOnce({
        ...MessageFactory.build(),
        id: messageId,
        linkPreviews: [successPreview],
        spans: [],
        reactions: [],
        attachments: [],
      });

      const spans = [{ text: 'Check https://good.com and https://bad.com' }];
      await service.processMessageLinkPreviews(
        messageId,
        spans,
        roomId,
        serverEvent,
      );

      expect(mockFetchLinkMetadata).toHaveBeenCalledTimes(2);
      expect(mockDatabase.message.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: { linkPreviews: [successPreview] },
      });
      expect(websocketService.sendToRoom).toHaveBeenCalled();
    });

    it('should format attachments correctly in broadcast payload', async () => {
      const preview: linkPreviewUtils.LinkPreviewData = {
        url: 'https://example.com',
        title: 'Example',
      };
      mockFetchLinkMetadata.mockResolvedValue(preview);

      mockDatabase.message.findUnique.mockResolvedValueOnce({
        id: messageId,
        deletedAt: null,
      });
      mockDatabase.message.update.mockResolvedValue({});

      const updatedMessage = {
        ...MessageFactory.build(),
        id: messageId,
        linkPreviews: [preview],
        spans: [],
        reactions: [
          { emoji: '👍', userId: 'user-1' },
          { emoji: '👍', userId: 'user-2' },
        ],
        attachments: [
          {
            id: 'ma-0',
            messageId,
            fileId: 'file-1',
            position: 0,
            file: {
              id: 'file-1',
              filename: 'image.png',
              mimeType: 'image/png',
              fileType: 'IMAGE',
              size: 2048,
              thumbnailPath: '/thumbs/file-1.jpg',
            },
          },
        ],
      };
      mockDatabase.message.findUnique.mockResolvedValueOnce(updatedMessage);

      const spans = [{ text: 'See https://example.com' }];
      await service.processMessageLinkPreviews(
        messageId,
        spans,
        roomId,
        serverEvent,
      );

      const emittedPayload = (websocketService.sendToRoom as jest.Mock).mock
        .calls[0][2];
      const msg = emittedPayload.message;

      // Reactions should be grouped
      expect(msg.reactions).toEqual([
        { emoji: '👍', userIds: ['user-1', 'user-2'] },
      ]);

      // Attachments should be flattened
      expect(msg.attachments).toEqual([
        {
          id: 'file-1',
          filename: 'image.png',
          mimeType: 'image/png',
          fileType: 'IMAGE',
          size: 2048,
          hasThumbnail: true,
        },
      ]);
    });

    it('should not emit when re-read finds no message', async () => {
      const preview: linkPreviewUtils.LinkPreviewData = {
        url: 'https://example.com',
        title: 'Example',
      };
      mockFetchLinkMetadata.mockResolvedValue(preview);

      // Existence check passes
      mockDatabase.message.findUnique.mockResolvedValueOnce({
        id: messageId,
        deletedAt: null,
      });
      mockDatabase.message.update.mockResolvedValue({});
      // Re-read returns null (message deleted between update and re-read)
      mockDatabase.message.findUnique.mockResolvedValueOnce(null);

      const spans = [{ text: 'Visit https://example.com' }];
      await service.processMessageLinkPreviews(
        messageId,
        spans,
        roomId,
        serverEvent,
      );

      expect(mockDatabase.message.update).toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });
  });
});
