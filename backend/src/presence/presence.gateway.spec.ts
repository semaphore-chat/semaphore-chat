import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { PresenceGateway } from './presence.gateway';
import { PresenceService } from './presence.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { ServerEvents } from '@semaphore-chat/shared';

describe('PresenceGateway', () => {
  let gateway: PresenceGateway;
  let presenceService: Mocked<PresenceService>;
  let websocketService: Mocked<WebsocketService>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(PresenceGateway).compile();

    gateway = unit;
    presenceService = unitRef.get(PresenceService);
    websocketService = unitRef.get(WebsocketService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('should have services', () => {
    expect(presenceService).toBeDefined();
    expect(websocketService).toBeDefined();
  });

  describe('afterInit', () => {
    it('should log initialization', () => {
      const loggerSpy = jest.spyOn(gateway['logger'], 'log');
      const mockServer = {} as any;

      gateway.afterInit(mockServer);

      expect(loggerSpy).toHaveBeenCalledWith('PresenceGateway initialized');
    });
  });

  describe('handleConnection', () => {
    it('should log client connection', () => {
      const loggerSpy = jest.spyOn(gateway['logger'], 'debug');
      const mockClient = { id: 'test-socket-id' } as any;

      gateway.handleConnection(mockClient);

      expect(loggerSpy).toHaveBeenCalledWith(
        'Client connected to PresenceGateway: test-socket-id',
      );
    });

    it('should handle multiple connections', () => {
      const loggerSpy = jest.spyOn(gateway['logger'], 'debug');

      gateway.handleConnection({ id: 'socket-1' } as any);
      gateway.handleConnection({ id: 'socket-2' } as any);
      gateway.handleConnection({ id: 'socket-3' } as any);

      expect(loggerSpy).toHaveBeenCalledTimes(3);
      expect(loggerSpy).toHaveBeenCalledWith(
        'Client connected to PresenceGateway: socket-1',
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        'Client connected to PresenceGateway: socket-2',
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        'Client connected to PresenceGateway: socket-3',
      );
    });
  });

  describe('handleMessage (PRESENCE_ONLINE)', () => {
    it('should add connection and broadcast when user goes online', async () => {
      const mockClient = {
        id: 'socket-123',
        handshake: {
          user: {
            id: 'user-123',
            username: 'testuser',
            displayName: 'Test User',
            avatarUrl: 'https://example.com/avatar.jpg',
          },
        },
      } as any;

      presenceService.addConnection.mockResolvedValue(true); // User went online

      const result = await gateway.handleMessage(mockClient);

      expect(result).toBe('ACK');
      expect(presenceService.addConnection).toHaveBeenCalledWith(
        'user-123',
        'socket-123',
        60,
      );
      expect(websocketService.sendToAll).toHaveBeenCalledWith(
        ServerEvents.USER_ONLINE,
        {
          userId: 'user-123',
          username: 'testuser',
          displayName: 'Test User',
          avatarUrl: 'https://example.com/avatar.jpg',
        },
      );
    });

    it('should not broadcast when user already online', async () => {
      const mockClient = {
        id: 'socket-456',
        handshake: {
          user: {
            id: 'user-456',
            username: 'existinguser',
            displayName: 'Existing User',
            avatarUrl: null,
          },
        },
      } as any;

      presenceService.addConnection.mockResolvedValue(false); // User was already online

      const result = await gateway.handleMessage(mockClient);

      expect(result).toBe('ACK');
      expect(presenceService.addConnection).toHaveBeenCalledWith(
        'user-456',
        'socket-456',
        60,
      );
      expect(websocketService.sendToAll).not.toHaveBeenCalled();
    });

    it('should call setConnectionIdle with true when idle flag is true', async () => {
      const mockClient = {
        id: 'socket-idle',
        handshake: {
          user: {
            id: 'user-idle',
            username: 'idleuser',
            displayName: 'Idle User',
            avatarUrl: null,
          },
        },
      } as any;

      presenceService.addConnection.mockResolvedValue(false);

      await gateway.handleMessage(mockClient, { idle: true });

      expect(presenceService.setConnectionIdle).toHaveBeenCalledWith(
        'user-idle',
        'socket-idle',
        true,
      );
    });

    it('should call setConnectionIdle with false when idle flag is false', async () => {
      const mockClient = {
        id: 'socket-active',
        handshake: {
          user: {
            id: 'user-active',
            username: 'activeuser',
            displayName: 'Active User',
            avatarUrl: null,
          },
        },
      } as any;

      presenceService.addConnection.mockResolvedValue(false);

      await gateway.handleMessage(mockClient, { idle: false });

      expect(presenceService.setConnectionIdle).toHaveBeenCalledWith(
        'user-active',
        'socket-active',
        false,
      );
    });

    it('should default idle to false when no data provided', async () => {
      const mockClient = {
        id: 'socket-nodata',
        handshake: {
          user: {
            id: 'user-nodata',
            username: 'nodatauser',
            displayName: 'No Data User',
            avatarUrl: null,
          },
        },
      } as any;

      presenceService.addConnection.mockResolvedValue(false);

      await gateway.handleMessage(mockClient);

      expect(presenceService.setConnectionIdle).toHaveBeenCalledWith(
        'user-nodata',
        'socket-nodata',
        false,
      );
    });

    it('should handle multiple clients from same user', async () => {
      const mockClient1 = {
        id: 'socket-1',
        handshake: {
          user: {
            id: 'user-multi',
            username: 'multiuser',
            displayName: 'Multi User',
            avatarUrl: null,
          },
        },
      } as any;

      const mockClient2 = {
        id: 'socket-2',
        handshake: {
          user: {
            id: 'user-multi',
            username: 'multiuser',
            displayName: 'Multi User',
            avatarUrl: null,
          },
        },
      } as any;

      presenceService.addConnection
        .mockResolvedValueOnce(true) // First connection - goes online
        .mockResolvedValueOnce(false); // Second connection - already online

      await gateway.handleMessage(mockClient1);
      await gateway.handleMessage(mockClient2);

      expect(websocketService.sendToAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleDisconnect', () => {
    it('should remove connection and broadcast when user goes offline', async () => {
      const mockClient = {
        id: 'socket-789',
        handshake: {
          user: {
            id: 'user-789',
            username: 'disconnectuser',
            displayName: 'Disconnect User',
            avatarUrl: 'https://example.com/avatar2.jpg',
          },
        },
      } as any;

      presenceService.removeConnection.mockResolvedValue(true); // User went offline

      await gateway.handleDisconnect(mockClient);

      expect(presenceService.removeConnection).toHaveBeenCalledWith(
        'user-789',
        'socket-789',
      );
      expect(websocketService.sendToAll).toHaveBeenCalledWith(
        ServerEvents.USER_OFFLINE,
        {
          userId: 'user-789',
          username: 'disconnectuser',
          displayName: 'Disconnect User',
          avatarUrl: 'https://example.com/avatar2.jpg',
        },
      );
    });

    it('should not broadcast when user still has other connections', async () => {
      const mockClient = {
        id: 'socket-999',
        handshake: {
          user: {
            id: 'user-999',
            username: 'activeuser',
            displayName: 'Active User',
            avatarUrl: null,
          },
        },
      } as any;

      presenceService.removeConnection.mockResolvedValue(false); // User still online

      await gateway.handleDisconnect(mockClient);

      expect(presenceService.removeConnection).toHaveBeenCalledWith(
        'user-999',
        'socket-999',
      );
      expect(websocketService.sendToAll).not.toHaveBeenCalled();
    });

    it('should handle disconnect without user in handshake', async () => {
      const mockClient = {
        id: 'socket-no-user',
        handshake: {},
      } as any;

      await gateway.handleDisconnect(mockClient);

      expect(presenceService.removeConnection).not.toHaveBeenCalled();
      expect(websocketService.sendToAll).not.toHaveBeenCalled();
    });

    it('should handle disconnect with partial user data', async () => {
      const mockClient = {
        id: 'socket-partial',
        handshake: {
          user: null,
        },
      } as any;

      await gateway.handleDisconnect(mockClient);

      expect(presenceService.removeConnection).not.toHaveBeenCalled();
      expect(websocketService.sendToAll).not.toHaveBeenCalled();
    });
  });
});
