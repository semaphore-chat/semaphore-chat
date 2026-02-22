import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), dev: vi.fn(), info: vi.fn(), debug: vi.fn() },
  default: { warn: vi.fn(), error: vi.fn(), dev: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockSocket = {
  connected: false,
  active: true,
  removeAllListeners: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(),
};

const mockIo = vi.fn(() => mockSocket);

vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => mockIo(...args),
}));

vi.mock('../../config/env', () => ({
  getWebSocketUrl: vi.fn(() => 'ws://localhost:3000'),
}));

const mockGetAccessToken = vi.fn();
vi.mock('../../utils/tokenService', () => ({
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}));

import { getSocketSingleton, disconnectSocket } from '../../utils/socketSingleton';

describe('socketSingleton', () => {
  beforeEach(() => {
    // Reset the module-level singleton between tests
    disconnectSocket();
    vi.clearAllMocks();
    mockSocket.connected = false;
    mockSocket.active = true;
  });

  // ─── getSocketSingleton ─────────────────────────────────────────

  describe('getSocketSingleton', () => {
    it('creates a new socket when none exists', () => {
      mockGetAccessToken.mockReturnValue('valid-token');

      const socket = getSocketSingleton();

      expect(mockIo).toHaveBeenCalledOnce();
      expect(socket).toBe(mockSocket);
    });

    it('passes correct options to io()', () => {
      mockGetAccessToken.mockReturnValue('valid-token');

      getSocketSingleton();

      expect(mockIo).toHaveBeenCalledWith('ws://localhost:3000', expect.objectContaining({
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        randomizationFactor: 0.5,
      }));
    });

    it('uses a callback function for auth that reads the current token', () => {
      mockGetAccessToken.mockReturnValue('initial-token');

      getSocketSingleton();

      const options = mockIo.mock.calls[0][1] as { auth: (cb: (data: { token: string }) => void) => void };
      expect(typeof options.auth).toBe('function');

      // Auth function uses Socket.IO callback pattern: auth(cb) => cb(data)
      let authData: { token: string } | undefined;
      options.auth((data) => { authData = data; });
      expect(authData).toEqual({ token: 'Bearer initial-token' });

      // Simulate token refresh — auth function picks up new token
      mockGetAccessToken.mockReturnValue('refreshed-token');
      options.auth((data) => { authData = data; });
      expect(authData).toEqual({ token: 'Bearer refreshed-token' });
    });

    it('returns existing connected socket without creating a new one', () => {
      mockGetAccessToken.mockReturnValue('valid-token');

      const socket1 = getSocketSingleton();
      mockSocket.connected = true;
      mockSocket.active = true;
      const socket2 = getSocketSingleton();

      expect(mockIo).toHaveBeenCalledOnce();
      expect(socket1).toBe(socket2);
    });

    it('returns existing socket that is still connecting (active but not connected)', () => {
      mockGetAccessToken.mockReturnValue('valid-token');

      // Create initial socket — it starts active but not yet connected
      const socket1 = getSocketSingleton();
      mockSocket.connected = false;
      mockSocket.active = true;

      // Second call (e.g. StrictMode double-invoke) should reuse, not tear down
      const socket2 = getSocketSingleton();

      expect(mockIo).toHaveBeenCalledOnce();
      expect(socket1).toBe(socket2);
      expect(mockSocket.removeAllListeners).not.toHaveBeenCalled();
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
    });

    it('tears down stale disconnected socket and creates a new one', () => {
      mockGetAccessToken.mockReturnValue('valid-token');

      // Create initial socket
      getSocketSingleton();
      expect(mockIo).toHaveBeenCalledOnce();

      // Socket was explicitly disconnected (e.g. by disconnectSocket() during logout)
      mockSocket.connected = false;
      mockSocket.active = false;

      // Create a new mock for the second io() call
      const newMockSocket = {
        connected: false,
        active: true,
        removeAllListeners: vi.fn(),
        disconnect: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        connect: vi.fn(),
      };
      mockIo.mockReturnValueOnce(newMockSocket);

      const socket2 = getSocketSingleton();

      // Should have cleaned up the old socket
      expect(mockSocket.removeAllListeners).toHaveBeenCalled();
      expect(mockSocket.disconnect).toHaveBeenCalled();

      // Should have created a new one
      expect(mockIo).toHaveBeenCalledTimes(2);
      expect(socket2).toBe(newMockSocket);
    });

    it('throws when no access token is available', () => {
      mockGetAccessToken.mockReturnValue(null);

      expect(() => getSocketSingleton()).toThrow('No token available');
    });

    it('does not call io() when token is missing', () => {
      mockGetAccessToken.mockReturnValue(null);

      try { getSocketSingleton(); } catch { /* expected */ }

      expect(mockIo).not.toHaveBeenCalled();
    });
  });

  // ─── disconnectSocket ──────────────────────────────────────────

  describe('disconnectSocket', () => {
    it('cleans up an existing socket', () => {
      mockGetAccessToken.mockReturnValue('valid-token');
      getSocketSingleton();

      disconnectSocket();

      expect(mockSocket.removeAllListeners).toHaveBeenCalled();
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('does not throw when no socket exists', () => {
      expect(() => disconnectSocket()).not.toThrow();
    });

    it('allows creating a fresh socket after disconnect', () => {
      mockGetAccessToken.mockReturnValue('valid-token');

      getSocketSingleton();
      expect(mockIo).toHaveBeenCalledOnce();

      disconnectSocket();

      const newMockSocket = {
        connected: false,
        active: true,
        removeAllListeners: vi.fn(),
        disconnect: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        connect: vi.fn(),
      };
      mockIo.mockReturnValueOnce(newMockSocket);

      const socket = getSocketSingleton();

      expect(mockIo).toHaveBeenCalledTimes(2);
      expect(socket).toBe(newMockSocket);
    });

    it('is idempotent — calling twice does not throw', () => {
      mockGetAccessToken.mockReturnValue('valid-token');
      getSocketSingleton();

      disconnectSocket();
      expect(() => disconnectSocket()).not.toThrow();
    });
  });
});
