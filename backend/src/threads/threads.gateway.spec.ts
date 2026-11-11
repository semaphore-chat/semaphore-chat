import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ThreadsGateway } from './threads.gateway';
import { ThreadsService } from './threads.service';
import { WsException } from '@nestjs/websockets';

describe('ThreadsGateway', () => {
  let gateway: ThreadsGateway;
  let threadsService: Mocked<ThreadsService>;

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

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(ThreadsGateway).compile();

    gateway = unit;
    threadsService = unitRef.get(ThreadsService);

    threadsService.sendThreadReply = jest.fn().mockResolvedValue(mockReply);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleThreadReply', () => {
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
