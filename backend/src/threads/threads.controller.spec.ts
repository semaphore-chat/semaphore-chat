import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ThreadsController } from './threads.controller';
import { ThreadsService } from './threads.service';

describe('ThreadsController', () => {
  let controller: ThreadsController;
  let threadsService: Mocked<ThreadsService>;

  const userId = 'user-123';
  const mockReq = { user: { id: userId } } as any;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(ThreadsController).compile();

    controller = unit;
    threadsService = unitRef.get(ThreadsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createReply', () => {
    it('should call service with correct args', async () => {
      const parentMessageId = 'parent-msg-123';
      const body = {
        spans: [{ type: 'PLAINTEXT', text: 'Hello' }],
        attachments: [],
      };
      const mockReply = { id: 'reply-123', authorId: userId } as any;

      threadsService.sendThreadReply.mockResolvedValue({
        reply: mockReply,
        created: true,
      });

      const result = await controller.createReply(
        parentMessageId,
        body as any,
        mockReq,
      );

      expect(result).toEqual(mockReply);
      expect(threadsService.sendThreadReply).toHaveBeenCalledWith(
        { ...body, parentMessageId },
        userId,
      );
    });
  });

  describe('getReplies', () => {
    it('should call service with default limit', async () => {
      const parentMessageId = 'parent-msg-123';
      const mockResponse = { replies: [], continuationToken: undefined };

      threadsService.getThreadRepliesWithMetadata.mockResolvedValue(
        mockResponse,
      );

      const req = { user: { id: 'viewer-1' } } as never;
      const result = await controller.getReplies(parentMessageId, 50, req);

      expect(result).toEqual(mockResponse);
      expect(threadsService.getThreadRepliesWithMetadata).toHaveBeenCalledWith(
        parentMessageId,
        50,
        undefined,
        'viewer-1',
      );
    });

    it('should pass continuation token', async () => {
      const parentMessageId = 'parent-msg-123';
      const token = 'cursor-123';
      const mockResponse = { replies: [], continuationToken: undefined };

      threadsService.getThreadRepliesWithMetadata.mockResolvedValue(
        mockResponse,
      );

      const req = { user: { id: 'viewer-1' } } as never;
      await controller.getReplies(parentMessageId, 20, req, token);

      expect(threadsService.getThreadRepliesWithMetadata).toHaveBeenCalledWith(
        parentMessageId,
        20,
        token,
        'viewer-1',
      );
    });
  });

  describe('getMetadata', () => {
    it('should call service with user ID', async () => {
      const parentMessageId = 'parent-msg-123';
      const mockMetadata = {
        parentMessageId,
        replyCount: 5,
        lastReplyAt: new Date(),
        isSubscribed: true,
      };

      threadsService.getThreadMetadata.mockResolvedValue(mockMetadata);

      const result = await controller.getMetadata(parentMessageId, mockReq);

      expect(result).toEqual(mockMetadata);
      expect(threadsService.getThreadMetadata).toHaveBeenCalledWith(
        parentMessageId,
        userId,
      );
    });
  });

  describe('subscribe', () => {
    it('should call service to subscribe', async () => {
      const parentMessageId = 'parent-msg-123';
      threadsService.subscribeToThread.mockResolvedValue(undefined);

      await controller.subscribe(parentMessageId, mockReq);

      expect(threadsService.subscribeToThread).toHaveBeenCalledWith(
        parentMessageId,
        userId,
      );
    });
  });

  describe('unsubscribe', () => {
    it('should call service to unsubscribe', async () => {
      const parentMessageId = 'parent-msg-123';
      threadsService.unsubscribeFromThread.mockResolvedValue(undefined);

      await controller.unsubscribe(parentMessageId, mockReq);

      expect(threadsService.unsubscribeFromThread).toHaveBeenCalledWith(
        parentMessageId,
        userId,
      );
    });
  });
});
