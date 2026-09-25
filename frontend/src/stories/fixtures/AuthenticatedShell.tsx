/**
 * Reassembles the provider stack `AuthGate` (components/AuthGate.tsx) mounts
 * once a session is authenticated — MINUS `SocketProvider`, which opens a
 * real `socket.io-client` WebSocket via `getSocketSingleton()`. That's wrong
 * for a static sandbox with no backend, so this renders `SocketContext`
 * directly with an inert fake socket instead (matches the design doc and
 * the existing Vitest pattern in `__tests__/test-utils/wrappers.tsx`).
 *
 * Everything else here is the same tree AuthGate renders on success:
 * AvatarCacheProvider > NotificationProvider > VoiceProvider > RoomProvider >
 * SpeakingProvider > ThreadPanelProvider > UserProfileProvider.
 *
 * `voiceState` seeds VoiceProvider's reducer via the small `initialState`
 * seam added to `contexts/VoiceProvider.tsx` for exactly this purpose.
 */
import React from 'react';
import { SocketContext } from '../../utils/SocketContext';
import { AvatarCacheProvider } from '../../contexts/AvatarCacheContext';
import { NotificationProvider } from '../../contexts/NotificationContext';
import { type VoiceState } from '../../contexts/VoiceContext';
import { VoiceProvider } from '../../contexts/VoiceProvider';
import { RoomProvider } from '../../contexts/RoomContext';
import { SpeakingProvider } from '../../contexts/SpeakingContext';
import { ThreadPanelProvider } from '../../contexts/ThreadPanelProvider';
import { UserProfileProvider } from '../../contexts/UserProfileProvider';
import { createFakeSocket } from './fakeSocket';
import { configureMockAuth } from './auth';

// One fake socket per browser tab is plenty — nothing on the other end ever
// changes, so there's no reason to recreate it per story.
const fakeSocket = createFakeSocket();

export interface AuthenticatedShellProps {
  children: React.ReactNode;
  voiceState?: Partial<VoiceState>;
  /** Fake `SocketContext.isConnected` — set `false` for a "Reconnecting..." banner story. */
  isSocketConnected?: boolean;
}

export const AuthenticatedShell: React.FC<AuthenticatedShellProps> = ({ children, voiceState, isSocketConnected = true }) => {
  configureMockAuth();
  return (
    <SocketContext.Provider value={{ socket: fakeSocket as never, isConnected: isSocketConnected }}>
      <AvatarCacheProvider>
        <NotificationProvider>
          <VoiceProvider initialState={voiceState}>
            <RoomProvider>
              <SpeakingProvider>
                <ThreadPanelProvider>
                  <UserProfileProvider>{children}</UserProfileProvider>
                </ThreadPanelProvider>
              </SpeakingProvider>
            </RoomProvider>
          </VoiceProvider>
        </NotificationProvider>
      </AvatarCacheProvider>
    </SocketContext.Provider>
  );
};
