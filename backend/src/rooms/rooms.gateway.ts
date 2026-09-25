import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { RoomsService } from './rooms.service';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards, UseFilters } from '@nestjs/common';
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
export class RoomsGateway implements OnGatewayDisconnect, OnGatewayInit {
  private readonly logger = new Logger(RoomsGateway.name);
  private readonly connectionAttempts = new Map<
    string,
    { count: number; resetAt: number }
  >();

  static readonly RATE_LIMIT_MAX = 10;
  static readonly RATE_LIMIT_WINDOW_MS = 60_000;

  constructor(
    private readonly roomsService: RoomsService,
    private readonly websocketService: WebsocketService,
    private readonly wsAuthService: WsAuthService,
    private readonly socketSessionService: SocketSessionService,
  ) {}

  afterInit(server: Server) {
    this.websocketService.setServer(server);

    // Rate-limiting middleware — runs before auth
    server.use((socket, next) => {
      const ip = socket.handshake.address;
      const now = Date.now();
      const entry = this.connectionAttempts.get(ip);

      if (entry && now < entry.resetAt) {
        entry.count++;
        if (entry.count > RoomsGateway.RATE_LIMIT_MAX) {
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
