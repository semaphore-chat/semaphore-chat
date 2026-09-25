import React from 'react';
import type { Room } from 'livekit-client';
import { RoomContext } from '../../contexts/RoomContextDef';

/**
 * Shadows `AuthenticatedShell`'s real `RoomProvider` for descendants — must
 * be rendered as (a descendant of) `SandboxShell`'s `children` slot, which is
 * INSIDE that real provider, not wrapped around `SandboxShell` itself.
 */
export const FakeRoomProvider: React.FC<{ room: Room; children: React.ReactNode }> = ({ room, children }) => (
  <RoomContext.Provider value={{ room, setRoom: () => {}, getRoom: () => room }}>
    {children}
  </RoomContext.Provider>
);
