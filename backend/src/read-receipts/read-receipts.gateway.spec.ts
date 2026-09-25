import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ReadReceiptsGateway } from './read-receipts.gateway';
import { ReadReceiptsService } from './read-receipts.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { WsException } from '@nestjs/websockets';
import { ServerEvents } from '@semaphore-chat/shared';

describe('ReadReceiptsGateway', () => {
  let gateway: ReadReceiptsGateway;
  let readReceiptsService: Mocked<ReadReceiptsService>;
  let notificationsService: Mocked<NotificationsService>;
  let websocketService: Mocked<WebsocketService>;

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
    notificationsService = unitRef.get(NotificationsService);
    websocketService = unitRef.get(WebsocketService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleMarkAsRead', () => {
    const channelPayload = {
      lastReadMessageId: 'msg-5',
      channelId: 'ch-1',
    };

    const dmPayload = {
      lastReadMessageId: 'msg-10',
      directMessageGroupId: 'dm-1',
    };

    beforeEach(() => {
      readReceiptsService.markAsRead = jest.fn().mockResolvedValue({
        channelId: 'ch-1',
        directMessageGroupId: null,
        lastReadMessageId: 'msg-5',
        lastReadAt: '2024-06-01T00:00:00Z',
      });
      notificationsService.markContextNotificationsAsRead = jest
        .fn()
        .mockResolvedValue(undefined);
    });

    it('calls readReceiptsService.markAsRead with the correct userId and payload', async () => {
      await gateway.handleMarkAsRead(channelPayload, makeClient());

      expect(readReceiptsService.markAsRead).toHaveBeenCalledWith(
        'user-1',
        channelPayload,
      );
    });

    it('calls notificationsService.markContextNotificationsAsRead for the context', async () => {
      await gateway.handleMarkAsRead(channelPayload, makeClient());

      expect(
        notificationsService.markContextNotificationsAsRead,
      ).toHaveBeenCalledWith('user-1', 'ch-1', null);
    });

    it('emits READ_RECEIPT_UPDATED to user room', async () => {
      await gateway.handleMarkAsRead(channelPayload, makeClient());

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-1',
        ServerEvents.READ_RECEIPT_UPDATED,
        expect.objectContaining({
          channelId: 'ch-1',
          lastReadMessageId: 'msg-5',
        }),
      );
    });

    it('does NOT emit to a channel room for channel contexts (privacy)', async () => {
      await gateway.handleMarkAsRead(channelPayload, makeClient());

      const roomCalls = (
        websocketService.sendToRoom as jest.Mock
      ).mock.calls.map((c: unknown[]) => c[0]);
      expect(roomCalls).not.toContain('channel:ch-1');
      // Should only emit to the user room
      expect(roomCalls).toEqual(['user:user-1']);
    });

    it('also emits to DM room for DM contexts with user identity', async () => {
      readReceiptsService.markAsRead = jest.fn().mockResolvedValue({
        channelId: null,
        directMessageGroupId: 'dm-1',
        lastReadMessageId: 'msg-10',
        lastReadAt: '2024-06-01T00:00:00Z',
      });

      await gateway.handleMarkAsRead(dmPayload, makeClient());

      // First call: user room
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-1',
        ServerEvents.READ_RECEIPT_UPDATED,
        expect.anything(),
      );
      // Second call: DM room
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'dm:dm-1',
        ServerEvents.READ_RECEIPT_UPDATED,
        expect.anything(),
      );

      // The DM room emission should include user identity
      const dmEmitCall = (
        websocketService.sendToRoom as jest.Mock
      ).mock.calls.find(
        (call: unknown[]) =>
          call[0] === 'dm:dm-1' &&
          call[1] === ServerEvents.READ_RECEIPT_UPDATED,
      );
      expect(dmEmitCall).toBeDefined();
      expect(dmEmitCall![2]).toMatchObject({
        userId: 'user-1',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: 'https://img.test/alice.png',
      });
    });

    it('wraps service errors in WsException', async () => {
      readReceiptsService.markAsRead = jest
        .fn()
        .mockRejectedValue(new Error('DB connection failed'));

      await expect(
        gateway.handleMarkAsRead(channelPayload as any, makeClient()),
      ).rejects.toThrow(WsException);
    });

    it('wraps unknown errors in a generic WsException message', async () => {
      readReceiptsService.markAsRead = jest
        .fn()
        .mockRejectedValue('unexpected');

      await expect(
        gateway.handleMarkAsRead(channelPayload as any, makeClient()),
      ).rejects.toThrow(WsException);
    });

    it('marks DM notifications as read with correct context IDs', async () => {
      readReceiptsService.markAsRead = jest.fn().mockResolvedValue({
        channelId: null,
        directMessageGroupId: 'dm-1',
        lastReadMessageId: 'msg-10',
        lastReadAt: '2024-06-01T00:00:00Z',
      });

      await gateway.handleMarkAsRead(dmPayload, makeClient());

      expect(
        notificationsService.markContextNotificationsAsRead,
      ).toHaveBeenCalledWith('user-1', null, 'dm-1');
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
