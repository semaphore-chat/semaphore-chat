import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ServerEvents } from '@semaphore-chat/shared';
import {
  extractTokenFromHandshake,
  AuthenticatedSocket,
  getSocketAuth,
} from '@/common/utils/socket.utils';
import { Socket } from 'socket.io';
import { WsAuthError, WsAuthService } from './ws-auth.service';

@Injectable()
export class WsJwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtAuthGuard.name);

  constructor(private readonly wsAuthService: WsAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'ws') return true;
    const client = context.switchToWs().getClient<Socket>();

    // Authenticated by the connection middleware. Its token may have expired
    // since: the socket's expiry timer disconnects it, but don't let a
    // message slip through in between (e.g. a delayed timer).
    if ((client as AuthenticatedSocket).handshake.user) {
      const auth = getSocketAuth(client);
      if (auth && auth.exp * 1000 <= Date.now()) {
        this.logger.debug(`Socket ${client.id} used an expired token`);
        client.emit(ServerEvents.SESSION_TERMINATED, {
          reason: 'TOKEN_EXPIRED',
        });
        client.disconnect(true);
        return false;
      }
      return true;
    }

    const token = extractTokenFromHandshake(client.handshake);
    if (!token) {
      this.logger.warn(
        'No token provided in handshake. Ensure you are passing the token in the correct format.',
      );
      client.disconnect(true);
      return false;
    }
    try {
      const { user } = await this.wsAuthService.authenticate(token);
      (client as AuthenticatedSocket).handshake.user = user;
      return true;
    } catch (error) {
      if (error instanceof WsAuthError) {
        this.logger.warn(`WebSocket authentication failed: ${error.code}`);
      } else {
        this.logger.error('WebSocket authentication failed', error);
      }
      client.disconnect(true);
      return false;
    }
  }
}
