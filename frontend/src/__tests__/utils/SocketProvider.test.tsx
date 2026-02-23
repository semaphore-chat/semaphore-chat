import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { SocketProvider } from '../../utils/SocketProvider';

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

  return {
    connected: false,
    active: true,
    id: 'test-socket-id',
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
});
