import React, { useRef, useEffect, useCallback, useMemo, useState } from "react";
import type { Room } from "livekit-client";
import { useVoiceDispatch } from "./VoiceContext";
import { RoomContext, RoomContextType } from "./RoomContextDef";
import { getApiBaseUrl } from "../config/env";
import { getAccessToken } from "../utils/tokenService";

interface RoomProviderProps {
  children: React.ReactNode;
}

export const RoomProvider: React.FC<RoomProviderProps> = ({ children }) => {
  const roomRef = useRef<Room | null>(null);
  // Use stateRef from dispatch context (stable, no re-renders from voice state changes)
  // instead of useVoice() which subscribes to ALL state changes and causes
  // cascading re-renders through every useRoom() consumer (12+ hooks).
  const { stateRef } = useVoiceDispatch();
  // Track the room object in state so context consumers re-render when the room changes
  const [room, setRoomState] = useState<Room | null>(null);

  // Handle page unload - notify backend before disconnect
  useEffect(() => {
    const handleBeforeUnload = () => {
      const token = getAccessToken();
      const baseUrl = getApiBaseUrl();
      const state = stateRef.current;
      const channelId = state.currentChannelId;
      const dmGroupId = state.currentDmGroupId;

      // Use fetch with keepalive to ensure request completes during page unload
      if (channelId) {
        fetch(`${baseUrl}/channels/${channelId}/voice-presence/leave`, {
          method: "DELETE",
          keepalive: true,
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }).catch(() => {
          // Ignore errors during unload - best effort
        });
      }

      if (dmGroupId) {
        fetch(`${baseUrl}/dm-groups/${dmGroupId}/voice-presence/leave`, {
          method: "DELETE",
          keepalive: true,
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }).catch(() => {
          // Ignore errors during unload - best effort
        });
      }

      // Also disconnect LiveKit room immediately
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [stateRef]);

  // Clean up room when voice state transitions to disconnected.
  // Uses stateRef to check isConnected without subscribing to VoiceState context.
  // Runs when the room state variable changes (setRoom triggers setRoomState).
  // IMPORTANT: Must also check isConnecting to avoid disconnecting during the
  // connection window (room exists but SetConnected hasn't been dispatched yet).
  useEffect(() => {
    const state = stateRef.current;
    if (!state.isConnected && !state.isConnecting && roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
      setRoomState(null);
    }
  }, [room, stateRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    };
  }, []);

  const setRoom = useCallback((newRoom: Room | null) => {
    if (roomRef.current && roomRef.current !== newRoom) {
      roomRef.current.disconnect();
    }
    roomRef.current = newRoom;
    setRoomState(newRoom);
  }, []);

  const getRoom = useCallback(() => roomRef.current, []);

  const value = useMemo<RoomContextType>(() => ({
    room,
    setRoom,
    getRoom,
  }), [room, setRoom, getRoom]);

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
};
