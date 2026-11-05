import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ReadReceiptsGateway } from './read-receipts.gateway';
import { ReadReceiptsService } from './read-receipts.service';
import { WsException } from '@nestjs/websockets';

describe('ReadReceiptsGateway', () => {
  let gateway: ReadReceiptsGateway;
  let readReceiptsService: Mocked<ReadReceiptsService>;

  const makeClient = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'socket-1',
      handshake: {
        user: {
          id: 'user-1',
          username: 'alice',
          displayName: 'Alice',
          avatarUrl: 'https://img.test/alice.png',
          ...overrides,
        },
      },
    }) as any;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(ReadReceiptsGateway).compile();

    gateway = unit;
    readReceiptsService = unitRef.get(ReadReceiptsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleMarkAsRead', () => {
    const payload = { lastReadMessageId: 'msg-5', channelId: 'ch-1' };

    it('marks it read and announces it, as the socket user', async () => {
      readReceiptsService.markReadAndAnnounce = jest.fn().mockResolvedValue({
        channelId: 'ch-1',
        directMessageGroupId: null,
      });
      const client = makeClient();

      await gateway.handleMarkAsRead(payload, client);

      expect(readReceiptsService.markReadAndAnnounce).toHaveBeenCalledWith(
        client.handshake.user,
        payload,
      );
    });

    it('wraps service errors in WsException', async () => {
      readReceiptsService.markReadAndAnnounce = jest
        .fn()
        .mockRejectedValue(new Error('DB error'));

      await expect(
        gateway.handleMarkAsRead(payload as any, makeClient()),
      ).rejects.toThrow(WsException);
    });

    it('wraps unknown errors in a generic WsException message', async () => {
      readReceiptsService.markReadAndAnnounce = jest
        .fn()
        .mockRejectedValue('not an Error');

      await expect(
        gateway.handleMarkAsRead(payload as any, makeClient()),
      ).rejects.toThrow('Failed to mark messages as read');
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
