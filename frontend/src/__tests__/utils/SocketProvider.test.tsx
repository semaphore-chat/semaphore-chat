import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useContext } from 'react';
import { SocketContext } from '../../utils/SocketContext';

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), dev: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockGetSocketSingleton = vi.fn();
vi.mock('../../utils/socketSingleton', () => ({
  getSocketSingleton: (...args: unknown[]) => mockGetSocketSingleton(...args),
  disconnectSocket: vi.fn(),
}));

const mockRefreshToken = vi.fn();
const mockNotifyAuthFailure = vi.fn();
const tokenRefreshedListeners = new Set<(token: string) => void>();
vi.mock('../../utils/tokenService', () => ({
  refreshToken: (...args: unknown[]) => mockRefreshToken(...args),
  notifyAuthFailure: (...args: unknown[]) => mockNotifyAuthFailure(...args),
  onTokenRefreshed: (listener: (token: string) => void) => {
    tokenRefreshedListeners.add(listener);
    return () => tokenRefreshedListeners.delete(listener);
  },
}));

/** What tokenService does after a successful refresh. */
function simulateTokenRefreshed(token: string) {
  tokenRefreshedListeners.forEach((listener) => listener(token));
}

import { ClientEvents, ServerEvents } from '@semaphore-chat/shared';
import { SocketProvider, TOKEN_REFRESH_JITTER_MS } from '../../utils/SocketProvider';

/** Reads socket and isConnected from context for assertions. */
function TestConsumer() {
  const { socket, isConnected } = useContext(SocketContext);
  return (
    <div>
      <span data-testid="connected">{String(isConnected)}</span>
      <span data-testid="has-socket">{String(!!socket)}</span>
    </div>
  );
}

/** Minimal mock socket with event handler tracking. */
function createTestSocket() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  // socket.timeout(ms).emitWithAck(...) — acknowledged emits
  const emitWithAck = vi.fn(() => Promise.resolve<unknown>({ ok: true, expiresAt: '' }));

  return {
    emitWithAck,
    timeout: vi.fn(() => ({ emitWithAck })),
    connected: false,
    active: true,
    id: 'test-socket-id',
    io: {
      opts: {
        reconnection: true,
      },
    },
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
    }),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    simulateEvent(event: string, ...args: unknown[]) {
      handlers.get(event)?.forEach(h => h(...args));
    },
  };
}

describe('SocketProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations: reset the ones tests override
    mockRefreshToken.mockReset();
    mockGetSocketSingleton.mockReset();
    tokenRefreshedListeners.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('provides socket and initial disconnected state', () => {
    const mockSocket = createTestSocket();
    mockGetSocketSingleton.mockReturnValue(mockSocket);

    render(<SocketProvider><TestConsumer /></SocketProvider>);

    expect(screen.getByTestId('has-socket')).toHaveTextContent('true');
    expect(screen.getByTestId('connected')).toHaveTextContent('false');
  });

  it('updates isConnected to true when connect event fires', () => {
    const mockSocket = createTestSocket();
    mockGetSocketSingleton.mockReturnValue(mockSocket);

    render(<SocketProvider><TestConsumer /></SocketProvider>);

    expect(screen.getByTestId('connected')).toHaveTextContent('false');

    act(() => {
      mockSocket.connected = true;
      mockSocket.simulateEvent('connect');
    });

    expect(screen.getByTestId('connected')).toHaveTextContent('true');
  });

  it('updates isConnected to false when disconnect event fires', () => {
    const mockSocket = createTestSocket();
    mockSocket.connected = true;
    mockGetSocketSingleton.mockReturnValue(mockSocket);

    render(<SocketProvider><TestConsumer /></SocketProvider>);

    expect(screen.getByTestId('connected')).toHaveTextContent('true');

    act(() => {
      mockSocket.connected = false;
      mockSocket.simulateEvent('disconnect', 'transport close');
    });

    expect(screen.getByTestId('connected')).toHaveTextContent('false');
  });

  it('syncs isConnected when socket connects before effect registers listeners', () => {
    // Simulates the race condition where the socket connects between
    // useState initialization (reads connected=false → isConnected starts false)
    // and the useEffect body (reads connected=true → should sync).
    // This happens during StrictMode cleanup/re-mount cycles.
    const mockSocket = createTestSocket();

    let connectedReadCount = 0;
    Object.defineProperty(mockSocket, 'connected', {
      get() {
        connectedReadCount++;
        // First read: useState(socket?.connected ?? false) → false
        // Subsequent reads: useEffect sync check → true
        return connectedReadCount > 1;
      },
      set() { /* no-op for test */ },
      configurable: true,
    });

    mockGetSocketSingleton.mockReturnValue(mockSocket);

    render(<SocketProvider><TestConsumer /></SocketProvider>);

    expect(screen.getByTestId('connected')).toHaveTextContent('true');
  });

  it('provides null socket when getSocketSingleton throws', () => {
    mockGetSocketSingleton.mockImplementation(() => {
      throw new Error('No token');
    });

    render(<SocketProvider><TestConsumer /></SocketProvider>);

    expect(screen.getByTestId('has-socket')).toHaveTextContent('false');
    expect(screen.getByTestId('connected')).toHaveTextContent('false');
  });

  it('cleans up event listeners on unmount', () => {
    const mockSocket = createTestSocket();
    mockGetSocketSingleton.mockReturnValue(mockSocket);

    const { unmount } = render(<SocketProvider><TestConsumer /></SocketProvider>);

    expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('connect_error', expect.any(Function));

    unmount();

    expect(mockSocket.off).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockSocket.off).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(mockSocket.off).toHaveBeenCalledWith('connect_error', expect.any(Function));
  });

  describe('AUTH_FAILED connect_error handling', () => {
    it('should attempt token refresh on AUTH_FAILED error', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshToken.mockResolvedValue('new-token');

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        mockSocket.simulateEvent('connect_error', new Error('AUTH_FAILED'));
        // Flush the promise chain
        await vi.runAllTimersAsync();
      });

      expect(mockRefreshToken).toHaveBeenCalled();
      expect(mockSocket.io.opts.reconnection).toBe(true);
      expect(mockSocket.connect).toHaveBeenCalled();
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it('should call notifyAuthFailure when refresh returns null', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshToken.mockResolvedValue(null);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        mockSocket.simulateEvent('connect_error', new Error('AUTH_FAILED'));
        await vi.runAllTimersAsync();
      });

      expect(mockRefreshToken).toHaveBeenCalled();
      expect(mockNotifyAuthFailure).toHaveBeenCalled();
      expect(mockSocket.connect).not.toHaveBeenCalled();
    });

    it('should call notifyAuthFailure when refresh throws', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshToken.mockRejectedValue(new Error('Refresh failed'));

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        mockSocket.simulateEvent('connect_error', new Error('AUTH_FAILED'));
        await vi.runAllTimersAsync();
      });

      expect(mockRefreshToken).toHaveBeenCalled();
      expect(mockNotifyAuthFailure).toHaveBeenCalled();
    });

    it('should temporarily disable reconnection during refresh', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      let resolveRefresh: (value: string | null) => void;
      mockRefreshToken.mockImplementation(
        () => new Promise((resolve) => { resolveRefresh = resolve; })
      );

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      act(() => {
        mockSocket.simulateEvent('connect_error', new Error('AUTH_FAILED'));
      });

      // Reconnection should be disabled during refresh
      expect(mockSocket.io.opts.reconnection).toBe(false);

      await act(async () => {
        resolveRefresh!('new-token');
        await vi.runAllTimersAsync();
      });

      // Re-enabled after refresh
      expect(mockSocket.io.opts.reconnection).toBe(true);
    });

    it('should not attempt refresh for non-auth errors', () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      act(() => {
        mockSocket.simulateEvent('connect_error', new Error('timeout'));
      });

      expect(mockRefreshToken).not.toHaveBeenCalled();
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });
  });

  describe('server disconnect backoff and circuit breaker', () => {
    it('should not immediately reconnect on server disconnect', () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      act(() => {
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
      });

      // Should not reconnect immediately
      expect(mockSocket.connect).not.toHaveBeenCalled();
    });

    it('should reconnect after backoff delay', () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      act(() => {
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
      });

      expect(mockSocket.connect).not.toHaveBeenCalled();

      // After 1s (first backoff)
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff on subsequent disconnects', () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      // First disconnect: 1s backoff
      act(() => {
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);

      // Second disconnect: 2s backoff
      act(() => {
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      // Should not have reconnected yet (need 2s)
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(mockSocket.connect).toHaveBeenCalledTimes(2);
    });

    it('should trigger circuit breaker after 3 server disconnects', () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      // Disconnect 1: schedules timer at 1s
      act(() => {
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
      });
      // Disconnect 2: clears timer from #1, schedules timer at 2s
      act(() => {
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
      });
      // Disconnect 3: clears timer from #2, circuit breaker triggers
      act(() => {
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
      });

      expect(mockNotifyAuthFailure).toHaveBeenCalled();

      // No reconnect timers should fire — all were cleared
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(mockSocket.connect).not.toHaveBeenCalled();
    });

    it('should reset disconnect counter on successful connect', () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      // Two disconnects
      act(() => {
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
      });
      act(() => {
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
      });

      // Successful connection resets counter
      act(() => {
        mockSocket.simulateEvent('connect');
      });

      // Two more disconnects should NOT trigger circuit breaker
      act(() => {
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
      });
      act(() => {
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
      });

      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it('should not use backoff for non-server-initiated disconnects', () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      act(() => {
        mockSocket.simulateEvent('disconnect', 'transport close');
      });

      // Should not call connect (Socket.IO handles non-server disconnects)
      expect(mockSocket.connect).not.toHaveBeenCalled();
      // Should not trigger circuit breaker
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });
  });

  describe('token expiry and re-authentication', () => {
    it('re-authenticates the connected socket whenever the token is refreshed', () => {
      const mockSocket = createTestSocket();
      mockSocket.connected = true;
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      act(() => {
        simulateTokenRefreshed('fresh-token');
      });

      expect(mockSocket.timeout).toHaveBeenCalled();
      expect(mockSocket.emitWithAck).toHaveBeenCalledWith(
        ClientEvents.REAUTHENTICATE,
        { token: 'Bearer fresh-token' },
      );
    });

    it('does not re-authenticate a socket that is not connected', () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      act(() => {
        simulateTokenRefreshed('fresh-token');
      });

      expect(mockSocket.emitWithAck).not.toHaveBeenCalled();
    });

    it.each([
      ['rejected', () => Promise.resolve({ ok: false, error: 'AUTH_FAILED' })],
      ['unanswered', () => Promise.reject(new Error('operation has timed out'))],
    ])('keeps the connection when re-authentication is %s', async (_, ack) => {
      const mockSocket = createTestSocket();
      mockSocket.connected = true;
      mockSocket.emitWithAck.mockImplementation(ack);
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        simulateTokenRefreshed('fresh-token');
        await vi.runAllTimersAsync();
      });

      expect(mockSocket.emitWithAck).toHaveBeenCalled();
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it('refreshes the token after a random delay when the server says it is expiring', async () => {
      const mockSocket = createTestSocket();
      mockSocket.connected = true;
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshToken.mockResolvedValue('fresh-token');
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      act(() => {
        mockSocket.simulateEvent(ServerEvents.TOKEN_EXPIRING, {
          expiresAt: new Date().toISOString(),
        });
        // A second warning while one refresh is pending changes nothing
        mockSocket.simulateEvent(ServerEvents.TOKEN_EXPIRING, {
          expiresAt: new Date().toISOString(),
        });
      });
      expect(mockRefreshToken).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_JITTER_MS / 2);
      });

      expect(mockRefreshToken).toHaveBeenCalledTimes(1);
      // The socket stays up: no disconnect, no reconnect
      expect(mockSocket.disconnect).not.toHaveBeenCalled();
      expect(mockSocket.connect).not.toHaveBeenCalled();
      vi.mocked(Math.random).mockRestore();
    });

    it('does not refresh after unmount', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      const { unmount } = render(<SocketProvider><TestConsumer /></SocketProvider>);
      act(() => {
        mockSocket.simulateEvent(ServerEvents.TOKEN_EXPIRING, {
          expiresAt: new Date().toISOString(),
        });
      });
      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_JITTER_MS);
      });

      expect(mockRefreshToken).not.toHaveBeenCalled();
      expect(tokenRefreshedListeners.size).toBe(0);
    });
  });

  describe('session ended by the server', () => {
    it('refreshes and reconnects right away when the token expired', async () => {
      const mockSocket = createTestSocket();
      mockSocket.connected = true;
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshToken.mockResolvedValue('fresh-token');

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        mockSocket.simulateEvent(ServerEvents.SESSION_TERMINATED, {
          reason: 'TOKEN_EXPIRED',
        });
        mockSocket.connected = false;
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
        await Promise.resolve();
      });

      // No backoff: the fresh token is all it takes
      expect(mockRefreshToken).toHaveBeenCalledTimes(1);
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it.each(['LOGGED_OUT', 'SESSION_REVOKED', 'PASSWORD_CHANGED', 'ACCOUNT_BANNED'])(
      'signs out when the session can no longer be refreshed (%s)',
      async (reason) => {
        const mockSocket = createTestSocket();
        mockSocket.connected = true;
        mockGetSocketSingleton.mockReturnValue(mockSocket);
        mockRefreshToken.mockResolvedValue(null);

        render(<SocketProvider><TestConsumer /></SocketProvider>);

        await act(async () => {
          mockSocket.simulateEvent(ServerEvents.SESSION_TERMINATED, { reason });
          mockSocket.simulateEvent('disconnect', 'io server disconnect');
          await vi.runAllTimersAsync();
        });

        expect(mockNotifyAuthFailure).toHaveBeenCalledTimes(1);
        expect(mockSocket.connect).not.toHaveBeenCalled();
      },
    );

    it('signs out when the refresh throws', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshToken.mockRejectedValue(new Error('network'));

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        mockSocket.simulateEvent(ServerEvents.SESSION_TERMINATED, {
          reason: 'TOKEN_EXPIRED',
        });
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
        await vi.runAllTimersAsync();
      });

      expect(mockNotifyAuthFailure).toHaveBeenCalledTimes(1);
    });

    it('reconnects a session another tab renewed (refresh still works)', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshToken.mockResolvedValue('token-from-new-login');

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        mockSocket.simulateEvent(ServerEvents.SESSION_TERMINATED, {
          reason: 'LOGGED_OUT',
        });
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
        await vi.runAllTimersAsync();
      });

      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it('does not count toward the server-disconnect circuit breaker', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshToken.mockResolvedValue('fresh-token');

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      for (let i = 0; i < 3; i++) {
        await act(async () => {
          mockSocket.simulateEvent(ServerEvents.SESSION_TERMINATED, {
            reason: 'TOKEN_EXPIRED',
          });
          mockSocket.simulateEvent('disconnect', 'io server disconnect');
          await vi.runAllTimersAsync();
        });
      }

      expect(mockSocket.connect).toHaveBeenCalledTimes(3);
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it('forgets the reason once reconnected, so a plain server disconnect backs off', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      act(() => {
        mockSocket.simulateEvent(ServerEvents.SESSION_TERMINATED, {
          reason: 'TOKEN_EXPIRED',
        });
        // Reconnected (e.g. the event arrived but the socket stayed up)
        mockSocket.simulateEvent('connect');
        mockSocket.simulateEvent('disconnect', 'io server disconnect');
      });

      expect(mockRefreshToken).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
    });
  });
});
