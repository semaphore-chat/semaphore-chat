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
const mockRefreshSession = vi.fn();
const mockNotifyAuthFailure = vi.fn();
const tokenRefreshedListeners = new Set<(token: string) => void>();
vi.mock('../../utils/tokenService', () => ({
  refreshToken: (...args: unknown[]) => mockRefreshToken(...args),
  refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
  notifyAuthFailure: (...args: unknown[]) => mockNotifyAuthFailure(...args),
  onTokenRefreshed: (listener: (token: string) => void) => {
    tokenRefreshedListeners.add(listener);
    return () => tokenRefreshedListeners.delete(listener);
  },
}));

/** refreshSession() results */
const refreshed = (token = 'fresh-token') => ({ status: 'refreshed', token }) as const;
const REJECTED = { status: 'rejected' } as const;
const UNAVAILABLE = { status: 'unavailable' } as const;

/** What tokenService does after a successful refresh. */
function simulateTokenRefreshed(token: string) {
  tokenRefreshedListeners.forEach((listener) => listener(token));
}

import { ClientEvents, ServerEvents } from '@semaphore-chat/shared';
import {
  SocketProvider,
  TOKEN_REFRESH_JITTER_MS,
  MAX_SESSION_REFRESH_ATTEMPTS,
} from '../../utils/SocketProvider';

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
    mockRefreshSession.mockReset();
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
      mockRefreshSession.mockResolvedValue(refreshed('new-token'));

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        mockSocket.simulateEvent('connect_error', new Error('AUTH_FAILED'));
        // Flush the promise chain
        await vi.runAllTimersAsync();
      });

      expect(mockRefreshSession).toHaveBeenCalled();
      expect(mockSocket.io.opts.reconnection).toBe(true);
      expect(mockSocket.connect).toHaveBeenCalled();
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it('should call notifyAuthFailure when the server refuses the refresh', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshSession.mockResolvedValue(REJECTED);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        mockSocket.simulateEvent('connect_error', new Error('AUTH_FAILED'));
        await vi.runAllTimersAsync();
      });

      expect(mockRefreshSession).toHaveBeenCalledTimes(1);
      expect(mockNotifyAuthFailure).toHaveBeenCalledTimes(1);
      expect(mockSocket.connect).not.toHaveBeenCalled();
      expect(mockSocket.io.opts.reconnection).toBe(true);
    });

    it('retries instead of signing out when the refresh fails for a network or server error', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshSession
        .mockResolvedValueOnce(UNAVAILABLE)
        .mockResolvedValueOnce(refreshed());

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        mockSocket.simulateEvent('connect_error', new Error('AUTH_FAILED'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mockRefreshSession).toHaveBeenCalledTimes(1);
      expect(mockSocket.connect).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(mockRefreshSession).toHaveBeenCalledTimes(2);
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it('should temporarily disable reconnection during refresh', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);

      let resolveRefresh: (value: unknown) => void;
      mockRefreshSession.mockImplementation(
        () => new Promise((resolve) => { resolveRefresh = resolve; })
      );

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      act(() => {
        mockSocket.simulateEvent('connect_error', new Error('AUTH_FAILED'));
      });

      // Reconnection should be disabled during refresh
      expect(mockSocket.io.opts.reconnection).toBe(false);

      await act(async () => {
        resolveRefresh!(refreshed('new-token'));
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

      expect(mockRefreshSession).not.toHaveBeenCalled();
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
    /** SESSION_TERMINATED, then the server's disconnect. */
    function endSession(
      mockSocket: ReturnType<typeof createTestSocket>,
      reason: string,
    ) {
      mockSocket.simulateEvent(ServerEvents.SESSION_TERMINATED, { reason });
      mockSocket.connected = false;
      mockSocket.simulateEvent('disconnect', 'io server disconnect');
    }

    it('refreshes and reconnects right away when the token expired', async () => {
      const mockSocket = createTestSocket();
      mockSocket.connected = true;
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshSession.mockResolvedValue(refreshed());

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        endSession(mockSocket, 'TOKEN_EXPIRED');
        await Promise.resolve();
      });

      // No backoff: the fresh token is all it takes
      expect(mockRefreshSession).toHaveBeenCalledTimes(1);
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it.each(['LOGGED_OUT', 'SESSION_REVOKED', 'PASSWORD_CHANGED', 'ACCOUNT_BANNED', 'ACCOUNT_DELETED'])(
      'signs out, with the reason, when the server refuses the refresh (%s)',
      async (reason) => {
        const mockSocket = createTestSocket();
        mockSocket.connected = true;
        mockGetSocketSingleton.mockReturnValue(mockSocket);
        mockRefreshSession.mockResolvedValue(REJECTED);

        render(<SocketProvider><TestConsumer /></SocketProvider>);

        await act(async () => {
          endSession(mockSocket, reason);
          await vi.runAllTimersAsync();
        });

        expect(mockNotifyAuthFailure).toHaveBeenCalledTimes(1);
        expect(mockNotifyAuthFailure).toHaveBeenCalledWith(reason);
        expect(mockSocket.connect).not.toHaveBeenCalled();
      },
    );

    it('retries with backoff, without signing out, when the refresh fails for a network or server error', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshSession
        .mockResolvedValueOnce(UNAVAILABLE)
        .mockResolvedValueOnce(UNAVAILABLE)
        .mockResolvedValueOnce(refreshed());

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        endSession(mockSocket, 'TOKEN_EXPIRED');
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mockRefreshSession).toHaveBeenCalledTimes(1);

      // 1s, then 2s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(999);
      });
      expect(mockRefreshSession).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(mockRefreshSession).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockRefreshSession).toHaveBeenCalledTimes(3);

      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it('treats a refresh that throws like a failed attempt, not a sign-out', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshSession
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce(refreshed());

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        endSession(mockSocket, 'TOKEN_EXPIRED');
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockRefreshSession).toHaveBeenCalledTimes(2);
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it('hands back to Socket.IO after the last attempt, and still signs out with the reason once the server answers', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshSession.mockResolvedValue(UNAVAILABLE);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        endSession(mockSocket, 'PASSWORD_CHANGED');
        await vi.runAllTimersAsync();
      });

      // Bounded: no more refreshes, the socket reconnects (Socket.IO keeps
      // retrying while the server is out of reach)
      expect(mockRefreshSession).toHaveBeenCalledTimes(MAX_SESSION_REFRESH_ATTEMPTS);
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      expect(mockSocket.io.opts.reconnection).toBe(true);
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();

      // The server answers: the stale token is refused, and so is the session
      mockRefreshSession.mockResolvedValue(REJECTED);
      await act(async () => {
        mockSocket.simulateEvent('connect_error', new Error('AUTH_FAILED'));
        await vi.runAllTimersAsync();
      });

      expect(mockNotifyAuthFailure).toHaveBeenCalledTimes(1);
      expect(mockNotifyAuthFailure).toHaveBeenCalledWith('PASSWORD_CHANGED');
    });

    it('sends no retry past the retry budget when attempts are slow (a retry past the grace window ends the session)', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      // Each attempt runs into the 10 s request timeout
      mockRefreshSession.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(UNAVAILABLE), 10_000)),
      );

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        endSession(mockSocket, 'TOKEN_EXPIRED');
        await vi.advanceTimersByTimeAsync(60_000);
      });

      // 0 s, then 11 s; the next would go out at 23 s
      expect(mockRefreshSession).toHaveBeenCalledTimes(2);
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it('stops retrying once unmounted', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshSession.mockResolvedValue(UNAVAILABLE);

      const { unmount } = render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        endSession(mockSocket, 'TOKEN_EXPIRED');
        await vi.advanceTimersByTimeAsync(0);
      });
      unmount();
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockRefreshSession).toHaveBeenCalledTimes(1);
      expect(mockSocket.connect).not.toHaveBeenCalled();
      expect(mockSocket.io.opts.reconnection).toBe(true);
    });

    it('reconnects a session another tab renewed (refresh still works)', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshSession.mockResolvedValue(refreshed('token-from-new-login'));

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        endSession(mockSocket, 'LOGGED_OUT');
        await vi.runAllTimersAsync();
      });

      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      expect(mockNotifyAuthFailure).not.toHaveBeenCalled();
    });

    it('drops a refresh still pending from TOKEN_EXPIRING', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshSession.mockResolvedValue(REJECTED);

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      await act(async () => {
        mockSocket.simulateEvent(ServerEvents.TOKEN_EXPIRING, {
          expiresAt: new Date().toISOString(),
        });
        endSession(mockSocket, 'LOGGED_OUT');
        await vi.advanceTimersByTimeAsync(TOKEN_REFRESH_JITTER_MS);
      });

      // Only the session-end refresh, not the delayed one
      expect(mockRefreshToken).not.toHaveBeenCalled();
      expect(mockRefreshSession).toHaveBeenCalledTimes(1);
      expect(mockNotifyAuthFailure).toHaveBeenCalledTimes(1);
    });

    it('does not count toward the server-disconnect circuit breaker', async () => {
      const mockSocket = createTestSocket();
      mockGetSocketSingleton.mockReturnValue(mockSocket);
      mockRefreshSession.mockResolvedValue(refreshed());

      render(<SocketProvider><TestConsumer /></SocketProvider>);

      for (let i = 0; i < 3; i++) {
        await act(async () => {
          endSession(mockSocket, 'TOKEN_EXPIRED');
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

      expect(mockRefreshSession).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
    });
  });
});
