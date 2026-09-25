/**
 * WebSocket Mocks
 *
 * Provides mocks for WebSocket-related services and clients for testing gateways.
 *
 * Usage:
 * ```typescript
 * // Mock WebsocketService
 * const mockWebsocket = createMockWebsocketService();
 * mockWebsocket.sendToUser.mockImplementation(() => {});
 *
 * // Mock Socket.IO client
 * const mockClient = createMockSocketClient('user123');
 * ```
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { WebsocketService } from '@/websocket/websocket.service';
import { Socket } from 'socket.io';

export type MockWebsocketService = {
  sendToUser: jest.Mock;
  sendToRoom: jest.Mock;
  sendToServer: jest.Mock;
  broadcastToInstance: jest.Mock;
  getUserSockets: jest.Mock;
  addUserSocket: jest.Mock;
  removeUserSocket: jest.Mock;
  joinRoom: jest.Mock;
  leaveRoom: jest.Mock;
  getRoomMembers: jest.Mock;
  disconnectUser: jest.Mock;
  joinSocketsToRoom: jest.Mock;
  setServer: jest.Mock;
  sendToAll: jest.Mock;
};

export function createMockWebsocketService(): MockWebsocketService {
  const userSockets = new Map<string, Set<string>>();
  const rooms = new Map<string, Set<string>>();

  return {
    sendToUser: jest.fn((userId: string, event: string, data: any) => {
      // Simulate sending to user
      return Promise.resolve();
    }),
    sendToRoom: jest.fn((room: string, event: string, data: any) => {
      // Simulate sending to room
    }),
    sendToServer: jest.fn((socketId: string, event: string, data: any) => {
      // Simulate sending to specific socket
    }),
    broadcastToInstance: jest.fn((event: string, data: any) => {
      // Simulate broadcasting to all
    }),
    getUserSockets: jest.fn((userId: string) => {
      return Array.from(userSockets.get(userId) || []);
    }),
    addUserSocket: jest.fn((userId: string, socketId: string) => {
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId)!.add(socketId);
    }),
    removeUserSocket: jest.fn((userId: string, socketId: string) => {
      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(socketId);
        if (sockets.size === 0) {
          userSockets.delete(userId);
        }
      }
    }),
    joinRoom: jest.fn((socketId: string, room: string) => {
      if (!rooms.has(room)) {
        rooms.set(room, new Set());
      }
      rooms.get(room)!.add(socketId);
    }),
    leaveRoom: jest.fn((socketId: string, room: string) => {
      const members = rooms.get(room);
      if (members) {
        members.delete(socketId);
        if (members.size === 0) {
          rooms.delete(room);
        }
      }
    }),
    getRoomMembers: jest.fn((room: string) => {
      return Array.from(rooms.get(room) || []);
    }),
    disconnectUser: jest.fn((userId: string) => {
      userSockets.delete(userId);
    }),
    joinSocketsToRoom: jest.fn().mockResolvedValue(undefined),
    setServer: jest.fn(),
    sendToAll: jest.fn(),
  };
}

/**
 * Create a mock Socket.IO client for gateway testing
 */
export type MockSocket = {
  id: string;
  userId?: string;
  user?: any;
  data: Record<string, any>;
  emit: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
  to: jest.Mock;
  disconnect: jest.Mock;
  handshake: {
    auth?: {
      token?: string;
    };
    headers?: Record<string, string>;
  };
};

export function createMockSocketClient(
  userId?: string,
  socketId?: string,
): MockSocket {
  const id = socketId || `socket-${Math.random().toString(36).substring(7)}`;

  const mockSocket: MockSocket = {
    id,
    userId,
    user: userId ? { id: userId } : undefined,
    data: {},
    emit: jest.fn().mockReturnThis(),
    join: jest.fn().mockReturnThis(),
    leave: jest.fn().mockReturnThis(),
    to: jest.fn().mockReturnThis(),
    disconnect: jest.fn(),
    handshake: {
      auth: {},
      headers: {},
    },
  };

  return mockSocket;
}

/**
 * Create multiple mock socket clients
 */
export function createMockSocketClients(count: number): MockSocket[] {
  return Array.from({ length: count }, (_, i) =>
    createMockSocketClient(`user-${i}`, `socket-${i}`),
  );
}

/**
 * Helper to reset WebsocketService mock
 */
export function resetWebsocketMock(mockWebsocket: MockWebsocketService): void {
  Object.values(mockWebsocket).forEach((method) => {
    if (jest.isMockFunction(method)) {
      method.mockClear();
    }
  });
}

/**
 * Create a mock provider for WebsocketService
 */
export const createWebsocketProvider = (
  mockWebsocket?: MockWebsocketService,
) => ({
  provide: WebsocketService,
  useValue: mockWebsocket || createMockWebsocketService(),
});
