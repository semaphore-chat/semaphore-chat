import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Socket } from 'socket.io';
import { ServerEvents, ReauthenticateResult } from '@semaphore-chat/shared';
import { WsAuthResult, WsAuthService } from '@/auth/ws-auth.service';
import { RoomName } from '@/common/utils/room-name.util';
import {
  AuthenticatedSocket,
  getSocketAuth,
  SocketAuthData,
} from '@/common/utils/socket.utils';

/**
 * How long before its access token expires a socket gets TOKEN_EXPIRING, so
 * the client can refresh the token and REAUTHENTICATE without a disconnect.
 */
export const TOKEN_EXPIRY_WARNING_SECONDS = 120;

/** Earliest TOKEN_EXPIRING after connecting or re-authenticating. */
const MIN_WARNING_DELAY_MS = 1000;

/** setTimeout's maximum delay; longer timers fire immediately. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Keeps a live socket bound to the access token it authenticated with.
 *
 * - Rooms: every socket is in `user:<id>`, `session:<sid>` and `token:<jti>`
 *   from the moment it connects, so revocations can disconnect exactly the
 *   right sockets on every instance (`server.in(room).disconnectSockets()`
 *   goes through the Redis adapter).
 * - Expiry: the socket is disconnected (SESSION_TERMINATED, TOKEN_EXPIRED)
 *   when its token expires. TOKEN_EXPIRING goes out first; a client that
 *   answers with REAUTHENTICATE and a fresh token keeps its connection.
 */
@Injectable()
export class SocketSessionService implements OnModuleDestroy {
  private readonly logger = new Logger(SocketSessionService.name);
  private readonly timers = new Map<
    string,
    { warning: NodeJS.Timeout; expiry: NodeJS.Timeout }
  >();

  constructor(private readonly wsAuthService: WsAuthService) {}

  onModuleDestroy() {
    for (const socketId of [...this.timers.keys()]) {
      this.clearTimers(socketId);
    }
  }

  /**
   * Bind a socket that just authenticated (connection middleware) to its
   * token. Called once per socket.
   */
  attach(socket: Socket, auth: WsAuthResult): void {
    (socket as AuthenticatedSocket).handshake.user = auth.user;
    this.bindToken(socket, auth);
    socket.once('disconnect', () => this.clearTimers(socket.id));
  }

  /**
   * Swap the socket's token for a fresh one of the same user, keeping the
   * connection. A rejected token leaves the socket as it was: it still ends
   * when its current token expires.
   */
  async reauthenticate(
    socket: Socket,
    token: string,
  ): Promise<ReauthenticateResult> {
    const current = getSocketAuth(socket);
    let auth: WsAuthResult;
    try {
      auth = await this.wsAuthService.authenticate(token);
    } catch {
      return { ok: false, error: 'AUTH_FAILED' };
    }

    if (!current || auth.claims.sub !== current.userId) {
      this.logger.warn(
        `Socket ${socket.id} tried to re-authenticate as another user`,
      );
      return { ok: false, error: 'AUTH_FAILED' };
    }
    // Disconnected (e.g. revoked) while the token was being checked.
    if (socket.disconnected) return { ok: false, error: 'AUTH_FAILED' };

    (socket as AuthenticatedSocket).handshake.user = auth.user;
    this.bindToken(socket, auth, current);
    return {
      ok: true,
      expiresAt: new Date(auth.claims.exp * 1000).toISOString(),
    };
  }

  private bindToken(
    socket: Socket,
    { claims }: WsAuthResult,
    previous?: SocketAuthData,
  ): void {
    const next: SocketAuthData = {
      userId: claims.sub,
      jti: claims.jti,
      sid: claims.sid,
      exp: claims.exp,
    };

    // Leave the rooms of the previous token first: a revocation of the old
    // token or session must no longer reach this socket.
    if (previous?.jti && previous.jti !== next.jti) {
      void socket.leave(RoomName.accessToken(previous.jti));
    }
    if (previous?.sid && previous.sid !== next.sid) {
      void socket.leave(RoomName.session(previous.sid));
    }

    const rooms = [RoomName.user(next.userId)];
    if (next.sid) rooms.push(RoomName.session(next.sid));
    if (next.jti) rooms.push(RoomName.accessToken(next.jti));
    void socket.join(rooms);

    (socket.data as { auth?: SocketAuthData }).auth = next;
    this.scheduleExpiry(socket, next.exp);
  }

  private scheduleExpiry(socket: Socket, exp: number): void {
    this.clearTimers(socket.id);

    const msLeft = exp * 1000 - Date.now();
    const expiresAt = new Date(exp * 1000).toISOString();

    const warning = setTimeout(
      () => {
        if (socket.connected) {
          socket.emit(ServerEvents.TOKEN_EXPIRING, { expiresAt });
        }
      },
      // A token already inside the warning window: warn after a moment, so
      // a socket that just connected has its listeners in place
      clampDelay(
        Math.max(
          msLeft - TOKEN_EXPIRY_WARNING_SECONDS * 1000,
          MIN_WARNING_DELAY_MS,
        ),
      ),
    );
    const expiry = setTimeout(() => this.onExpiry(socket), clampDelay(msLeft));
    // Never keep the process alive for a socket's sake.
    warning.unref();
    expiry.unref();

    this.timers.set(socket.id, { warning, expiry });
  }

  private onExpiry(socket: Socket): void {
    const auth = getSocketAuth(socket);
    // A timer clamped to setTimeout's maximum fires early: re-arm it.
    if (auth && auth.exp * 1000 > Date.now()) {
      this.scheduleExpiry(socket, auth.exp);
      return;
    }

    this.clearTimers(socket.id);
    this.logger.debug(`Socket ${socket.id}: access token expired`);
    socket.emit(ServerEvents.SESSION_TERMINATED, { reason: 'TOKEN_EXPIRED' });
    socket.disconnect(true);
  }

  private clearTimers(socketId: string): void {
    const timers = this.timers.get(socketId);
    if (!timers) return;
    clearTimeout(timers.warning);
    clearTimeout(timers.expiry);
    this.timers.delete(socketId);
  }
}

function clampDelay(ms: number): number {
  return Math.min(Math.max(ms, 0), MAX_TIMER_DELAY_MS);
}
