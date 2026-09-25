import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SocketContext } from '../../utils/SocketContext';
import { SocketHubContext } from '../../socket-hub/SocketHubContext';
import { createEventBus } from '../../socket-hub/emitter';
import type { EventBus } from '../../socket-hub/emitter';
import type { MockSocket } from './mockSocket';
import { ElectronProvider } from '../../contexts/ElectronProvider';
import type { ElectronAPI } from '../../types/electron-api';

interface WrapperOptions {
  queryClient: QueryClient;
  socket?: MockSocket | null;
  isConnected?: boolean;
}

/**
 * Creates a wrapper component for renderHook that provides
 * QueryClientProvider and optionally SocketContext.
 */
export function createTestWrapper({ queryClient, socket = null, isConnected = true }: WrapperOptions) {
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SocketContext.Provider value={{ socket: socket as never, isConnected: socket ? isConnected : false }}>
          {children}
        </SocketContext.Provider>
      </QueryClientProvider>
    );
  };
}

interface HubWrapperOptions {
  queryClient: QueryClient;
  eventBus?: EventBus;
  socket?: MockSocket | null;
  isConnected?: boolean;
}

/**
 * Creates a wrapper that includes SocketHubContext for testing hooks
 * that use useServerEvent().
 */
export function createTestHubWrapper({ queryClient, eventBus, socket = null, isConnected = true }: HubWrapperOptions) {
  const bus = eventBus ?? createEventBus();

  return function TestHubWrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SocketContext.Provider value={{ socket: socket as never, isConnected: socket ? isConnected : false }}>
          <SocketHubContext.Provider value={bus}>
            {children}
          </SocketHubContext.Provider>
        </SocketContext.Provider>
      </QueryClientProvider>
    );
  };
}

/**
 * A renderHook wrapper that gives `useElectronAPI()` the bridge `api` (e.g.
 * `createFakeElectronAPI({...})`, or `null` for a web browser):
 *
 *   renderHook(() => useDeepLinks(), { wrapper: createElectronWrapper(api) });
 */
export function createElectronWrapper(api: ElectronAPI | null) {
  return function ElectronWrapper({ children }: { children: React.ReactNode }) {
    return <ElectronProvider api={api}>{children}</ElectronProvider>;
  };
}
