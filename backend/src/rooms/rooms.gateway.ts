import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { RoomsService } from './rooms.service';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards, UseFilters } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Application } from 'express';
import * as proxyaddr from 'proxy-addr';
import { RbacGuard } from '@/auth/rbac.guard';
import { WsAuthService } from '@/auth/ws-auth.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { ClientEvents, ReauthenticateResult } from '@semaphore-chat/shared';
import { WsLoggingExceptionFilter } from '@/websocket/ws-exception.filter';
import { WsJwtAuthGuard } from '@/auth/ws-jwt-auth.guard';
import { WsThrottleGuard } from '@/auth/ws-throttle.guard';
import {
  getSocketUser,
  AuthenticatedSocket,
  extractTokenFromHandshake,
} from '@/common/utils/socket.utils';
import { SocketSessionService } from './socket-session.service';
import { ReauthenticateDto } from './dto/reauthenticate.dto';

@UseFilters(WsLoggingExceptionFilter)
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || true,
    credentials: true,
  },
  transports: ['websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
})
@UseGuards(WsThrottleGuard, WsJwtAuthGuard, RbacGuard)
export class RoomsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  private readonly logger = new Logger(RoomsGateway.name);
  private readonly connectionAttempts = new Map<
    string,
    { count: number; resetAt: number }
  >();

  /** Connections one client address may open per window, by default. */
  static readonly RATE_LIMIT_MAX = 10;
  static readonly RATE_LIMIT_WINDOW_MS = 60_000;

  /**
   * Connections one client address may open per window: WS_CONNECTION_RATE_LIMIT,
   * or RATE_LIMIT_MAX. Raised where many clients share an address (the E2E
   * stack, where every test browser comes from one host).
   */
  private readonly rateLimitMax = RoomsGateway.parseRateLimit(
    process.env.WS_CONNECTION_RATE_LIMIT,
  );

  constructor(
    private readonly roomsService: RoomsService,
    private readonly websocketService: WebsocketService,
    private readonly wsAuthService: WsAuthService,
    private readonly socketSessionService: SocketSessionService,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  private static parseRateLimit(value: string | undefined): number {
    const limit = Number(value);
    return value && Number.isInteger(limit) && limit > 0
      ? limit
      : RoomsGateway.RATE_LIMIT_MAX;
  }

  /**
   * The client address of a socket's handshake, as Express resolves `req.ip`
   * for an HTTP request (TRUST_PROXY): behind a reverse proxy, the address it
   * forwarded (X-Forwarded-For), not the proxy's own, which every client
   * would share.
   */
  private clientAddress(socket: Socket): string {
    const trust = this.httpAdapterHost.httpAdapter
      ?.getInstance<Application>()
      ?.get('trust proxy fn') as
      ((address: string, hop: number) => boolean) | undefined;
    if (typeof trust !== 'function') return socket.handshake.address;
    return proxyaddr(socket.request, trust);
  }

  afterInit(server: Server) {
    this.websocketService.setServer(server);

    // Rate-limiting middleware — runs before auth
    server.use((socket, next) => {
      const ip = this.clientAddress(socket);
      const now = Date.now();
      const entry = this.connectionAttempts.get(ip);

      if (entry && now < entry.resetAt) {
        entry.count++;
        if (entry.count > this.rateLimitMax) {
          this.logger.warn(
            `Rate limited connection from ${ip} (${entry.count} attempts)`,
          );
          return next(new Error('RATE_LIMITED'));
        }
      } else {
        // Clean up expired entries on each new/expired window to prevent unbounded growth
        if (this.connectionAttempts.size > 100) {
          for (const [key, val] of this.connectionAttempts) {
            if (now >= val.resetAt) this.connectionAttempts.delete(key);
          }
        }
        this.connectionAttempts.set(ip, {
          count: 1,
          resetAt: now + RoomsGateway.RATE_LIMIT_WINDOW_MS,
        });
      }

      next();
    });

    // Auth middleware — validates JWT and binds the socket to its token
    // (user, rooms, expiry) before connection
    server.use((socket, next) => {
      const token = extractTokenFromHandshake(socket.handshake);

      if (!token) {
        next(new Error('AUTH_FAILED'));
        return;
      }

      this.wsAuthService
        .authenticate(token)
        .then((auth) => {
          this.socketSessionService.attach(socket, auth);
          next();
        })
        .catch(() => {
          next(new Error('AUTH_FAILED'));
        });
    });
  }

  /**
   * The connection middleware authenticated the socket and then joined its
   * rooms, but a revocation in between sent its disconnect before the socket
   * was in them, and one sent while the socket was still connecting skipped
   * it (a disconnect only reaches connected sockets). Check again now that it
   * is connected; revocations after this reach it through its rooms.
   */
  async handleConnection(client: Socket) {
    await this.socketSessionService.confirmBinding(client);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage(ClientEvents.SUBSCRIBE_ALL)
  async subscribeAll(@ConnectedSocket() client: Socket) {
    const user = getSocketUser(client);
    this.logger.debug(`User ${user.id} subscribing to all rooms`);
    return this.roomsService.joinAllUserRooms(client as AuthenticatedSocket);
  }

  /**
   * Swap the socket's access token for a fresh one (after TOKEN_EXPIRING, or
   * whenever the client refreshed its token), so the socket outlives the
   * token it connected with.
   */
  @SubscribeMessage(ClientEvents.REAUTHENTICATE)
  async reauthenticate(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ReauthenticateDto,
  ): Promise<ReauthenticateResult> {
    const token = extractTokenFromHandshake({ auth: { token: dto.token } });
    if (!token) return { ok: false, error: 'AUTH_FAILED' };
    return this.socketSessionService.reauthenticate(client, token);
  }
}
