import { io, Socket } from "socket.io-client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "./SocketContext";
import { getWebSocketUrl } from "../config/env";
import { logger } from "./logger";
import { getAccessToken } from "./tokenService";

let socketInstance: Socket<ServerToClientEvents, ClientToServerEvents> | null =
  null;

/**
 * Get or create the socket singleton.
 *
 * Returns the socket immediately (it may not be connected yet).
 * SocketProvider tracks connection state via socket events.
 *
 * Uses a callback function for `auth` so Socket.IO automatically picks up
 * the latest token on every connection/reconnection attempt —
 * no manual token-refresh subscription needed.
 *
 * AuthGate guarantees a valid token before SocketProvider mounts,
 * so this function does not attempt token refresh.
 */
export function getSocketSingleton(): Socket<
  ServerToClientEvents,
  ClientToServerEvents
> {
  if (socketInstance?.active) {
    return socketInstance;
  }

  // Tear down any stale disconnected socket (e.g. from a previous session
  // with an expired token) so we create a fresh one with the current token.
  if (socketInstance) {
    logger.dev("[Socket] Cleaning up stale disconnected socket");
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }

  const token = getAccessToken();
  if (!token) {
    throw new Error(
      "No token available for socket connection. Please log in."
    );
  }

  const url = getWebSocketUrl();
  logger.dev("[Socket] Connecting to WebSocket URL:", url);

  socketInstance = io(url, {
    transports: ["websocket"],
    auth: (cb) => cb({ token: `Bearer ${getAccessToken()}` }),
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
  });

  return socketInstance;
}

/**
 * Disconnect the socket and cleanup.
 */
export function disconnectSocket(): void {
  if (socketInstance) {
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }
}
