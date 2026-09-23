/**
 * An inert stand-in for the real `socket.io-client` Socket used by
 * `SocketContext`. The real `SocketProvider` (utils/SocketProvider.tsx)
 * opens an actual WebSocket via `getSocketSingleton()` — wrong for a static
 * sandbox with no backend. Screens/components are instead wrapped directly
 * in `SocketContext.Provider` with this fake (see `AuthenticatedShell.tsx`),
 * matching the pattern already used by the Vitest test suite
 * (`__tests__/test-utils/mockSocket.ts`), just without a Vitest dependency
 * so it also works in the browser under Ladle.
 */
type Handler = (...args: unknown[]) => void;

export interface FakeSocket {
  on: (event: string, handler: Handler) => void;
  off: (event: string, handler: Handler) => void;
  once: (event: string, handler: Handler) => void;
  emit: (event: string, ...args: unknown[]) => void;
  connected: boolean;
  id: string;
}

export function createFakeSocket(): FakeSocket {
  const handlers = new Map<string, Set<Handler>>();
  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler);
    },
    once(event, handler) {
      const wrapped: Handler = (...args) => {
        handlers.get(event)?.delete(wrapped);
        handler(...args);
      };
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(wrapped);
    },
    emit() {
      // No-op — nothing is listening on the other end in the sandbox.
    },
    connected: true,
    id: 'ladle-fake-socket',
  };
}
