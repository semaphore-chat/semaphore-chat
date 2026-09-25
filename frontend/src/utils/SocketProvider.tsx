import { Socket } from "socket.io-client";
import React, { useEffect, useRef, useState } from "react";
import { getSocketSingleton } from "./socketSingleton";
import {
  SocketContext,
  ServerToClientEvents,
  ClientToServerEvents,
} from "./SocketContext";
import { logger } from "./logger";
import {
  refreshToken,
  refreshSession,
  notifyAuthFailure,
  onTokenRefreshed,
} from "./tokenService";
import {
  MAX_SESSION_REFRESH_ATTEMPTS,
  nextSessionRefreshDelayMs,
} from "./sessionRefreshPolicy";
import { ClientEvents, ServerEvents } from "@semaphore-chat/shared";
import type {
  ReauthenticateResult,
  SessionTerminatedPayload,
  SessionTerminatedReason,
} from "@semaphore-chat/shared";

const MAX_SERVER_DISCONNECT_RETRIES = 3;
const MAX_BACKOFF_MS = 10_000;

/**
 * TOKEN_EXPIRING arrives two minutes before the socket's token expires. Wait
 * a random part of this before refreshing, so several tabs (each with its own
 * socket and token) don't refresh at the same moment: they share the refresh
 * cookie, and two refreshes racing with the same cookie read as token reuse.
 */
export const TOKEN_REFRESH_JITTER_MS = 30_000;
const REAUTHENTICATE_TIMEOUT_MS = 10_000;

/**
 * Refresh attempts, when the socket needs a fresh token to reconnect, before
 * handing back to Socket.IO's reconnection. Only a refused refresh (401/403)
 * signs out; a network or server error is retried after 1s, 2s, 4s, within
 * the retry budget (SESSION_REFRESH_RETRY_BUDGET_MS). (Shared with the REST
 * interceptor's retry ladder; see sessionRefreshPolicy.)
 */
export { MAX_SESSION_REFRESH_ATTEMPTS };

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
  const serverDisconnectCount = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A token refresh to reconnect with is in progress (or waiting to retry)
  const isRecoveringSession = useRef(false);
  const sessionRefreshRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  // Why the server is about to disconnect us (SESSION_TERMINATED)
  const sessionEndReason = useRef<SessionTerminatedReason | null>(null);
  // Why the server last ended our session, until we are connected again:
  // what to tell the user if the session turns out to be gone for good
  const lastSessionEnd = useRef<SessionTerminatedReason | null>(null);
  const tokenRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track connection state via socket events
  useEffect(() => {
    if (!socket) return;
    let disposed = false;

    const onConnect = () => {
      logger.dev("[Socket] Connected:", socket.id);
      serverDisconnectCount.current = 0;
      sessionEndReason.current = null;
      lastSessionEnd.current = null;
      setIsConnected(true);
    };

    /**
     * Get a fresh token and reconnect with it. Signs out only when the
     * server refuses the session (401/403). A network or server error is
     * retried with backoff; after MAX_SESSION_REFRESH_ATTEMPTS, or once the
     * retry budget (see sessionRefreshPolicy) is spent, the socket reconnects
     * anyway: Socket.IO keeps retrying while the server is out of reach, and
     * once it answers, the stale token comes back as AUTH_FAILED and this
     * runs again.
     */
    const recoverSession = (attempt = 1, startedAt = Date.now()) => {
      isRecoveringSession.current = true;
      socket.io.opts.reconnection = false;

      const done = () => {
        isRecoveringSession.current = false;
        socket.io.opts.reconnection = true;
      };

      refreshSession()
        .catch(() => ({ status: "unavailable" }) as const)
        .then((result) => {
          if (disposed) return;
          if (result.status === "refreshed") {
            logger.dev("[Socket] Token refreshed, reconnecting...");
            done();
            socket.connect();
            return;
          }
          if (result.status === "rejected") {
            logger.error("[Socket] Session can't be refreshed, logging out");
            done();
            notifyAuthFailure(lastSessionEnd.current ?? undefined);
            return;
          }
          const delay = nextSessionRefreshDelayMs(attempt, startedAt);
          if (delay === null) {
            logger.warn(
              "[Socket] Token refresh keeps failing, reconnecting to wait for the server"
            );
            done();
            socket.connect();
            return;
          }
          logger.warn(
            `[Socket] Token refresh failed, retrying in ${delay}ms (attempt ${attempt})`
          );
          sessionRefreshRetryTimer.current = setTimeout(() => {
            sessionRefreshRetryTimer.current = null;
            recoverSession(attempt + 1, startedAt);
          }, delay);
        });
    };

    // Give the live socket the new token whenever it is refreshed (after
    // TOKEN_EXPIRING, or a REST 401), so it outlives the token it connected
    // with. Reconnects pick up the latest token through the auth callback.
    const reauthenticate = (token: string) => {
      if (!socket.connected) return;
      socket
        .timeout(REAUTHENTICATE_TIMEOUT_MS)
        .emitWithAck(ClientEvents.REAUTHENTICATE, { token: `Bearer ${token}` })
        .then((result: ReauthenticateResult) => {
          if (result.ok) {
            logger.dev("[Socket] Re-authenticated until", result.expiresAt);
          } else {
            logger.warn("[Socket] Re-authentication rejected", result.error);
          }
        })
        // Neither is fatal: at worst the server ends the session when the old
        // token expires, and we reconnect with a fresh one.
        .catch((err: unknown) => {
          logger.warn("[Socket] Re-authentication failed", err);
        });
    };
    const unsubscribeTokenRefreshed = onTokenRefreshed(reauthenticate);

    const onTokenExpiring = () => {
      if (tokenRefreshTimer.current) return;
      const delay = Math.random() * TOKEN_REFRESH_JITTER_MS;
      logger.dev(`[Socket] Token expiring, refreshing in ${Math.round(delay)}ms`);
      tokenRefreshTimer.current = setTimeout(() => {
        tokenRefreshTimer.current = null;
        // Success re-authenticates through onTokenRefreshed. Failure is left
        // to the expiry: the server ends the session, and the disconnect
        // handler below refreshes again (recoverSession).
        void refreshToken();
      }, delay);
    };

    const onSessionTerminated = ({ reason }: SessionTerminatedPayload) => {
      sessionEndReason.current = reason;
    };

    const onDisconnect = (reason: string) => {
      logger.warn(`[Socket] Disconnected: ${reason}`);
      setIsConnected(false);

      if (reason === "io server disconnect") {
        // Clear any pending reconnect timer from a previous disconnect
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }

        // The server ended our session (token expired, logged out, banned,
        // ...). A fresh token is the only way back: refresh and reconnect,
        // or sign out when the session can't be refreshed any more.
        const sessionEnd = sessionEndReason.current;
        if (sessionEnd) {
          sessionEndReason.current = null;
          lastSessionEnd.current = sessionEnd;
          // A refresh pending from TOKEN_EXPIRING is superseded by this one
          if (tokenRefreshTimer.current) {
            clearTimeout(tokenRefreshTimer.current);
            tokenRefreshTimer.current = null;
          }
          logger.warn(
            `[Socket] Session ended by the server (${sessionEnd}), refreshing token`
          );
          if (!isRecoveringSession.current) recoverSession();
          return;
        }

        serverDisconnectCount.current++;

        if (serverDisconnectCount.current >= MAX_SERVER_DISCONNECT_RETRIES) {
          // Circuit breaker — persistent auth problem
          logger.error(
            "[Socket] Too many server-initiated disconnects, logging out"
          );
          notifyAuthFailure();
          return;
        }

        // Exponential backoff: 1s, 2s, 4s... capped at 10s
        const delay = Math.min(
          1000 * Math.pow(2, serverDisconnectCount.current - 1),
          MAX_BACKOFF_MS
        );
        logger.warn(
          `[Socket] Server-initiated disconnect, reconnecting in ${delay}ms (attempt ${serverDisconnectCount.current})`
        );
        reconnectTimer.current = setTimeout(() => {
          socket.connect();
        }, delay);
      }
      // For all other reasons, Socket.IO will auto-reconnect
    };

    const onConnectError = (err: Error) => {
      logger.error("[Socket] Connection error:", err.message);

      if (err.message === "AUTH_FAILED" && !isRecoveringSession.current) {
        recoverSession();
      }
      // For non-auth errors, Socket.IO's built-in reconnection handles it
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on(ServerEvents.TOKEN_EXPIRING, onTokenExpiring);
    socket.on(ServerEvents.SESSION_TERMINATED, onSessionTerminated);

    // If the socket connected before this effect ran (or during a
    // StrictMode cleanup/re-register cycle), sync state now.
    if (socket.connected) {
      setIsConnected(true);
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off(ServerEvents.TOKEN_EXPIRING, onTokenExpiring);
      socket.off(ServerEvents.SESSION_TERMINATED, onSessionTerminated);
      unsubscribeTokenRefreshed();
      disposed = true;
      if (isRecoveringSession.current) {
        isRecoveringSession.current = false;
        socket.io.opts.reconnection = true;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (sessionRefreshRetryTimer.current) {
        clearTimeout(sessionRefreshRetryTimer.current);
        sessionRefreshRetryTimer.current = null;
      }
      if (tokenRefreshTimer.current) {
        clearTimeout(tokenRefreshTimer.current);
        tokenRefreshTimer.current = null;
      }
    };
  }, [socket]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}
