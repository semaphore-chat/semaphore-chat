import { TestBed } from '@suites/unit';
import { WebsocketService } from './websocket.service';
import { toWirePayload } from './websocket-wire.util';
import { Server } from 'socket.io';
import { ServerEvents } from '@semaphore-chat/shared';

describe('WebsocketService', () => {
  let service: WebsocketService;
  // sendToRoom/sendToAll are now generically typed to the real
  // ServerToClientEvents contract (Task 3, commit 3). These tests
  // deliberately exercise the generic wrapper mechanism itself (routing,
  // error handling, arg pass-through) with made-up event names, agnostic
  // of any specific event contract — so they call through this loosened
  // view of the same instance rather than the strict public type.
  let looseService: {
    setServer: (server: unknown) => void;
    sendToRoom: (room: string, event: string, payload: unknown) => boolean;
    sendToAll: (event: string, payload: unknown) => boolean;
    joinSocketsToRoom: (source: string, rooms: string | string[]) => void;
    removeSocketsFromRoom: (source: string, rooms: string | string[]) => void;
  };

  beforeEach(async () => {
    const { unit } = await TestBed.solitary(WebsocketService).compile();

    service = unit;
    looseService = service as unknown as typeof looseService;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('setServer', () => {
    it('should set the server instance', () => {
      const mockServer = {} as Server;

      service.setServer(mockServer);

      // Verify server was set by checking sendToAll returns true
      const mockEmit = jest.fn();
      service.setServer({ emit: mockEmit } as any);
      looseService.sendToAll('test-event', {});

      expect(mockEmit).toHaveBeenCalled();
    });

    it('should allow changing the server instance', () => {
      const mockServer1 = { emit: jest.fn() } as any;
      const mockServer2 = { emit: jest.fn() } as any;

      service.setServer(mockServer1);
      looseService.sendToAll('event1', {});

      service.setServer(mockServer2);
      looseService.sendToAll('event2', {});

      expect(mockServer1.emit).toHaveBeenCalledWith('event1', {});
      expect(mockServer2.emit).toHaveBeenCalledWith('event2', {});
    });
  });

  describe('sendToRoom', () => {
    it('should send event to specific room successfully', () => {
      const mockTo = jest.fn().mockReturnValue({ emit: jest.fn() });
      const mockServer = { to: mockTo } as any;

      service.setServer(mockServer);
      const result = looseService.sendToRoom('room-123', 'test-event', {
        data: 'test',
      });

      expect(result).toBe(true);
      expect(mockTo).toHaveBeenCalledWith('room-123');
    });

    it('should emit event with payload to room', () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      const mockServer = { to: mockTo } as any;

      service.setServer(mockServer);

      const payload = { userId: 'user-123', message: 'hello' };
      looseService.sendToRoom('room-456', 'message-event', payload);

      expect(mockEmit).toHaveBeenCalledWith('message-event', payload);
    });

    it('should return false when server is not initialized', () => {
      const result = looseService.sendToRoom('room-123', 'test-event', {});

      expect(result).toBe(false);
    });

    it('should return false on error', () => {
      const mockTo = jest.fn().mockImplementation(() => {
        throw new Error('Socket error');
      });
      const mockServer = { to: mockTo } as any;

      service.setServer(mockServer);
      const result = looseService.sendToRoom('room-error', 'test-event', {});

      expect(result).toBe(false);
    });

    it('should send to different rooms', () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      const mockServer = { to: mockTo } as any;

      service.setServer(mockServer);

      looseService.sendToRoom('room-1', 'event-1', { data: 1 });
      looseService.sendToRoom('room-2', 'event-2', { data: 2 });
      looseService.sendToRoom('room-3', 'event-3', { data: 3 });

      expect(mockTo).toHaveBeenCalledTimes(3);
      expect(mockTo).toHaveBeenCalledWith('room-1');
      expect(mockTo).toHaveBeenCalledWith('room-2');
      expect(mockTo).toHaveBeenCalledWith('room-3');
    });

    it('should send different events to same room', () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      const mockServer = { to: mockTo } as any;

      service.setServer(mockServer);

      looseService.sendToRoom('room-123', 'user-joined', { userId: 'user-1' });
      looseService.sendToRoom('room-123', 'user-left', { userId: 'user-2' });
      looseService.sendToRoom('room-123', 'message-sent', { message: 'hello' });

      expect(mockTo).toHaveBeenCalledTimes(3);
      expect(mockEmit).toHaveBeenCalledWith('user-joined', {
        userId: 'user-1',
      });
      expect(mockEmit).toHaveBeenCalledWith('user-left', { userId: 'user-2' });
      expect(mockEmit).toHaveBeenCalledWith('message-sent', {
        message: 'hello',
      });
    });
  });

  describe('sendToAll', () => {
    it('should broadcast event to all clients successfully', () => {
      const mockEmit = jest.fn();
      const mockServer = { emit: mockEmit } as any;

      service.setServer(mockServer);
      const result = looseService.sendToAll('broadcast-event', {
        data: 'test',
      });

      expect(result).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith('broadcast-event', {
        data: 'test',
      });
    });

    it('should emit event with payload to all clients', () => {
      const mockEmit = jest.fn();
      const mockServer = { emit: mockEmit } as any;

      service.setServer(mockServer);

      const payload = { announcement: 'Server maintenance in 5 minutes' };
      looseService.sendToAll('server-announcement', payload);

      expect(mockEmit).toHaveBeenCalledWith('server-announcement', payload);
    });

    it('should return false when server is not initialized', () => {
      const result = looseService.sendToAll('test-event', {});

      expect(result).toBe(false);
    });

    it('should return false on error', () => {
      const mockEmit = jest.fn().mockImplementation(() => {
        throw new Error('Broadcast error');
      });
      const mockServer = { emit: mockEmit } as any;

      service.setServer(mockServer);
      const result = looseService.sendToAll('error-event', {});

      expect(result).toBe(false);
    });

    it('should broadcast multiple different events', () => {
      const mockEmit = jest.fn();
      const mockServer = { emit: mockEmit } as any;

      service.setServer(mockServer);

      looseService.sendToAll('user-online', { userId: 'user-1' });
      looseService.sendToAll('user-offline', { userId: 'user-2' });
      looseService.sendToAll('system-update', { version: '1.0.0' });

      expect(mockEmit).toHaveBeenCalledTimes(3);
      expect(mockEmit).toHaveBeenCalledWith('user-online', {
        userId: 'user-1',
      });
      expect(mockEmit).toHaveBeenCalledWith('user-offline', {
        userId: 'user-2',
      });
      expect(mockEmit).toHaveBeenCalledWith('system-update', {
        version: '1.0.0',
      });
    });

    it('should handle null payload', () => {
      const mockEmit = jest.fn();
      const mockServer = { emit: mockEmit } as any;

      service.setServer(mockServer);
      const result = looseService.sendToAll('null-event', null);

      expect(result).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith('null-event', null);
    });

    it('should handle undefined payload', () => {
      const mockEmit = jest.fn();
      const mockServer = { emit: mockEmit } as any;

      service.setServer(mockServer);
      const result = looseService.sendToAll('undefined-event', undefined);

      expect(result).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith('undefined-event', undefined);
    });

    it('should normalize nested Dates to ISO strings (JSON wire form), not pass the raw Date through', () => {
      // Fixes #440: prior to the toWirePayload() normalization, this
      // asserted the raw Date object was passed straight to `.emit()`,
      // which is exactly the bug — the Redis adapter's notepack encoding
      // has no Date codec, so cross-replica clients received `{}` for
      // `lastSeen`. Same-node clients already got the ISO string below via
      // socket.io's own JSON encoding, so this is now what both paths agree on.
      const mockEmit = jest.fn();
      const mockServer = { emit: mockEmit } as any;

      service.setServer(mockServer);

      const complexPayload = {
        user: {
          id: 'user-123',
          name: 'Test User',
          metadata: {
            lastSeen: new Date('2024-01-01'),
            roles: ['admin', 'moderator'],
          },
        },
        action: 'login',
        timestamp: Date.now(),
      };

      const result = looseService.sendToAll('complex-event', complexPayload);

      expect(result).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith('complex-event', {
        ...complexPayload,
        user: {
          ...complexPayload.user,
          metadata: {
            ...complexPayload.user.metadata,
            lastSeen: complexPayload.user.metadata.lastSeen.toISOString(),
          },
        },
      });
      // The original object is untouched — normalization returns a new
      // object via JSON roundtrip rather than mutating the input in place.
      expect(complexPayload.user.metadata.lastSeen).toBeInstanceOf(Date);
    });
  });

  describe('toWirePayload normalization (fixes #440)', () => {
    it('converts a top-level Date field to an ISO string', () => {
      const mockEmit = jest.fn();
      const mockServer = { emit: mockEmit } as any;
      service.setServer(mockServer);

      const sentAt = new Date('2024-06-15T12:00:00.000Z');
      looseService.sendToAll('event', { sentAt });

      expect(mockEmit).toHaveBeenCalledWith('event', {
        sentAt: sentAt.toISOString(),
      });
    });

    it('converts Dates nested inside an array element (e.g. a replyTo-like nested message)', () => {
      const mockEmit = jest.fn();
      const mockServer = { emit: mockEmit } as any;
      service.setServer(mockServer);

      const sentAt = new Date('2024-06-15T12:00:00.000Z');
      const replyToSentAt = new Date('2024-06-14T09:30:00.000Z');
      const payload = {
        message: {
          id: 'msg-1',
          sentAt,
          replyTo: {
            id: 'msg-0',
            sentAt: replyToSentAt,
          },
          reactions: [{ emoji: '👍', reactedAt: replyToSentAt }],
        },
      };

      looseService.sendToAll('event', payload);

      expect(mockEmit).toHaveBeenCalledWith('event', {
        message: {
          id: 'msg-1',
          sentAt: sentAt.toISOString(),
          replyTo: {
            id: 'msg-0',
            sentAt: replyToSentAt.toISOString(),
          },
          reactions: [{ emoji: '👍', reactedAt: replyToSentAt.toISOString() }],
        },
      });
    });

    it('preserves null', () => {
      const mockEmit = jest.fn();
      const mockServer = { emit: mockEmit } as any;
      service.setServer(mockServer);

      looseService.sendToAll('event', null);

      expect(mockEmit).toHaveBeenCalledWith('event', null);
    });

    it('drops undefined object fields (JSON semantics)', () => {
      const mockEmit = jest.fn();
      const mockServer = { emit: mockEmit } as any;
      service.setServer(mockServer);

      looseService.sendToAll('event', {
        id: 'x',
        channelId: undefined,
        directMessageGroupId: 'dm-1',
      });

      expect(mockEmit).toHaveBeenCalledWith('event', {
        id: 'x',
        directMessageGroupId: 'dm-1',
      });
      const [, sentPayload] = mockEmit.mock.calls[0];
      expect(
        Object.prototype.hasOwnProperty.call(sentPayload, 'channelId'),
      ).toBe(false);
    });

    it('passes non-object payloads through unchanged', () => {
      const mockEmit = jest.fn();
      const mockServer = { emit: mockEmit } as any;
      service.setServer(mockServer);

      looseService.sendToAll('event', 'plain-string-payload');

      expect(mockEmit).toHaveBeenCalledWith('event', 'plain-string-payload');
    });

    it('does not mutate the original payload object (returns a new object)', () => {
      const mockEmit = jest.fn();
      const mockServer = { emit: mockEmit } as any;
      service.setServer(mockServer);

      const sentAt = new Date('2024-06-15T12:00:00.000Z');
      const payload = { id: 'msg-1', sentAt };

      looseService.sendToAll('event', payload);

      expect(payload.sentAt).toBeInstanceOf(Date);
      expect(payload.sentAt).toBe(sentAt);

      const [, sentPayload] = mockEmit.mock.calls[0];
      expect(sentPayload).not.toBe(payload);
    });

    it('normalizes payloads for sendToRoom the same way as sendToAll', () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      const mockServer = { to: mockTo } as any;
      service.setServer(mockServer);

      const sentAt = new Date('2024-06-15T12:00:00.000Z');
      looseService.sendToRoom('room-1', 'event', { id: 'msg-1', sentAt });

      expect(mockEmit).toHaveBeenCalledWith('event', {
        id: 'msg-1',
        sentAt: sentAt.toISOString(),
      });
    });

    describe('binary payload guard', () => {
      it('toWirePayload throws on a top-level Buffer instead of corrupting it', () => {
        expect(() =>
          toWirePayload({ id: 'msg-1', data: Buffer.from([1, 2, 3]) }),
        ).toThrow(/carries binary data \(Buffer\)/);
      });

      it('toWirePayload throws on binary nested at depth (typed array in an array)', () => {
        expect(() =>
          toWirePayload({ items: [{ chunk: new Uint8Array([9, 9]) }] }),
        ).toThrow(/carries binary data \(Uint8Array\)/);
      });

      it('toWirePayload throws on a raw ArrayBuffer field', () => {
        expect(() => toWirePayload({ buf: new ArrayBuffer(4) })).toThrow(
          /carries binary data \(ArrayBuffer\)/,
        );
      });

      it('sendToAll fails closed on a binary payload: no emit, error logged, returns false', () => {
        const mockEmit = jest.fn();
        const mockServer = { emit: mockEmit } as any;
        service.setServer(mockServer);
        const errorSpy = jest.spyOn(service['logger'], 'error');

        const result = looseService.sendToAll('event', {
          data: Buffer.from([1, 2, 3]),
        });

        expect(result).toBe(false);
        expect(mockEmit).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('event'),
          expect.objectContaining({
            message: expect.stringContaining('carries binary data'),
          }),
        );
      });

      it('sendToRoom fails closed on a binary payload: no emit, returns false', () => {
        const mockEmit = jest.fn();
        const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
        const mockServer = { to: mockTo } as any;
        service.setServer(mockServer);

        const result = looseService.sendToRoom('room-1', 'event', {
          chunk: new Uint8Array([9]),
        });

        expect(result).toBe(false);
        expect(mockEmit).not.toHaveBeenCalled();
      });
    });
  });

  describe('joinSocketsToRoom', () => {
    it('should join sockets from source room to target room', () => {
      const mockSocketsJoin = jest.fn();
      const mockIn = jest
        .fn()
        .mockReturnValue({ socketsJoin: mockSocketsJoin });
      const mockServer = { in: mockIn } as any;

      service.setServer(mockServer);
      service.joinSocketsToRoom('user-123', 'channel-456');

      expect(mockIn).toHaveBeenCalledWith('user-123');
      expect(mockSocketsJoin).toHaveBeenCalledWith('channel-456');
    });

    it('should join sockets to multiple rooms', () => {
      const mockSocketsJoin = jest.fn();
      const mockIn = jest
        .fn()
        .mockReturnValue({ socketsJoin: mockSocketsJoin });
      const mockServer = { in: mockIn } as any;

      service.setServer(mockServer);
      service.joinSocketsToRoom('user-123', ['room-1', 'room-2', 'room-3']);

      expect(mockIn).toHaveBeenCalledWith('user-123');
      expect(mockSocketsJoin).toHaveBeenCalledWith([
        'room-1',
        'room-2',
        'room-3',
      ]);
    });

    it('should not throw when server is not initialized', () => {
      expect(() => {
        service.joinSocketsToRoom('user-123', 'channel-456');
      }).not.toThrow();
    });

    it('should not throw on error', () => {
      const mockIn = jest.fn().mockImplementation(() => {
        throw new Error('Socket error');
      });
      const mockServer = { in: mockIn } as any;

      service.setServer(mockServer);

      expect(() => {
        service.joinSocketsToRoom('user-123', 'channel-456');
      }).not.toThrow();
    });
  });

  describe('removeSocketsFromRoom', () => {
    it('should remove sockets from source room from target room', () => {
      const mockSocketsLeave = jest.fn();
      const mockIn = jest
        .fn()
        .mockReturnValue({ socketsLeave: mockSocketsLeave });
      const mockServer = { in: mockIn } as any;

      service.setServer(mockServer);
      service.removeSocketsFromRoom('user-123', 'channel-456');

      expect(mockIn).toHaveBeenCalledWith('user-123');
      expect(mockSocketsLeave).toHaveBeenCalledWith('channel-456');
    });

    it('should remove sockets from multiple rooms', () => {
      const mockSocketsLeave = jest.fn();
      const mockIn = jest
        .fn()
        .mockReturnValue({ socketsLeave: mockSocketsLeave });
      const mockServer = { in: mockIn } as any;

      service.setServer(mockServer);
      service.removeSocketsFromRoom('user-123', ['room-1', 'room-2']);

      expect(mockIn).toHaveBeenCalledWith('user-123');
      expect(mockSocketsLeave).toHaveBeenCalledWith(['room-1', 'room-2']);
    });

    it('should not throw when server is not initialized', () => {
      expect(() => {
        service.removeSocketsFromRoom('user-123', 'channel-456');
      }).not.toThrow();
    });

    it('should not throw on error', () => {
      const mockIn = jest.fn().mockImplementation(() => {
        throw new Error('Socket error');
      });
      const mockServer = { in: mockIn } as any;

      service.setServer(mockServer);

      expect(() => {
        service.removeSocketsFromRoom('user-123', 'channel-456');
      }).not.toThrow();
    });
  });

  describe('terminateSessionsInRoom', () => {
    it('tells the sockets why, then disconnects them', () => {
      const calls: string[] = [];
      const mockEmit = jest.fn(() => calls.push('emit'));
      const mockDisconnectSockets = jest.fn(() => calls.push('disconnect'));
      const mockServer = {
        to: jest.fn().mockReturnValue({ emit: mockEmit }),
        in: jest.fn().mockReturnValue({
          disconnectSockets: mockDisconnectSockets,
        }),
      } as any;

      service.setServer(mockServer);
      service.terminateSessionsInRoom('session:abc', 'LOGGED_OUT');

      expect(mockServer.to).toHaveBeenCalledWith('session:abc');
      expect(mockEmit).toHaveBeenCalledWith(ServerEvents.SESSION_TERMINATED, {
        reason: 'LOGGED_OUT',
      });
      expect(mockServer.in).toHaveBeenCalledWith('session:abc');
      // Close the underlying connection too
      expect(mockDisconnectSockets).toHaveBeenCalledWith(true);
      expect(calls).toEqual(['emit', 'disconnect']);
    });

    it('should not throw when server is not initialized', () => {
      expect(() =>
        service.terminateSessionsInRoom('user:1', 'ACCOUNT_BANNED'),
      ).not.toThrow();
    });

    it('should not throw on error', () => {
      service.setServer({
        to: jest.fn(() => {
          throw new Error('Socket error');
        }),
      } as any);

      expect(() =>
        service.terminateSessionsInRoom('user:1', 'ACCOUNT_BANNED'),
      ).not.toThrow();
    });
  });
});
