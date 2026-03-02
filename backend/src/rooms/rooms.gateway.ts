import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { RoomsService } from './rooms.service';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards, UsePipes, UseFilters } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RbacGuard } from '@/auth/rbac.guard';
import { WebsocketService } from '@/websocket/websocket.service';
import { UserService } from '@/user/user.service';
import { UserEntity } from '@/user/dto/user-response.dto';
import { ClientEvents } from '@kraken/shared';
import { wsValidationPipe } from '@/common/pipes/ws-validation.pipe';
import { WsLoggingExceptionFilter } from '@/websocket/ws-exception.filter';
import { WsJwtAuthGuard } from '@/auth/ws-jwt-auth.guard';
import { WsThrottleGuard } from '@/auth/ws-throttle.guard';
import {
  getSocketUser,
  AuthenticatedSocket,
  extractTokenFromHandshake,
} from '@/common/utils/socket.utils';

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
@UsePipes(wsValidationPipe)
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
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
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

    // Auth middleware — validates JWT and attaches user before connection
    server.use((socket, next) => {
      const token = extractTokenFromHandshake(socket.handshake);

      if (!token) {
        next(new Error('AUTH_FAILED'));
        return;
      }

      let payload: { sub: string };
      try {
        payload = this.jwtService.verify<{ sub: string }>(token);
      } catch {
        next(new Error('AUTH_FAILED'));
        return;
      }

      this.userService
        .findById(payload.sub)
        .then((user) => {
          if (!user) {
            next(new Error('AUTH_FAILED'));
            return;
          }
          (socket.handshake as Record<string, any>).user = new UserEntity(user);
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
}
