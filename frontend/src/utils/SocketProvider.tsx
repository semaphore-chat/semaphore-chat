import { Socket } from "socket.io-client";
import React, { useEffect, useState } from "react";
import { getSocketSingleton } from "./socketSingleton";
import {
  SocketContext,
  ServerToClientEvents,
  ClientToServerEvents,
} from "./SocketContext";
import { logger } from "./logger";

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket] = useState<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(() => {
    try {
      return getSocketSingleton();
    } catch (err) {
      logger.error(
        "[Socket] Failed to create socket:",
        err instanceof Error ? err.message : err
      );
      return null;
    }
  });
  const [isConnected, setIsConnected] = useState(socket?.connected ?? false);

  // Track connection state via socket events
  useEffect(() => {
    if (!socket) return;

    const onConnect = () => {
      logger.dev("[Socket] Connected:", socket.id);
      setIsConnected(true);
    };

    const onDisconnect = (reason: string) => {
      logger.warn(`[Socket] Disconnected: ${reason}`);
      setIsConnected(false);

      if (reason === "io server disconnect") {
        // Server initiated disconnect — Socket.IO will NOT auto-reconnect
        logger.warn(
          "[Socket] Server-initiated disconnect, reconnecting explicitly"
        );
        socket.connect();
      }
      // For all other reasons, Socket.IO will auto-reconnect
    };

    const onConnectError = (err: Error) => {
      logger.error("[Socket] Connection error:", err.message);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
    };
  }, [socket]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}
