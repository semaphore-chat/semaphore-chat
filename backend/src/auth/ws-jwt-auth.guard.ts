import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ServerEvents } from '@semaphore-chat/shared';
import {
  AuthenticatedSocket,
  getSocketAuth,
} from '@/common/utils/socket.utils';
import { Socket } from 'socket.io';

/**
 * Admits messages only from sockets with a live session.
 *
 * Sockets authenticate once, in RoomsGateway's connection middleware, which
 * binds them to their access token (SocketSessionService: user, rooms,
 * expiry). Every gateway shares that server, so a socket without that binding
 * didn't come through it: refuse it rather than authenticate it here, where
 * the revocation rooms and expiry timer would be missing.
 */
@Injectable()
export class WsJwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'ws') return true;
    const client = context.switchToWs().getClient<Socket>();

    const auth = getSocketAuth(client);
    if (!(client as AuthenticatedSocket).handshake.user || !auth) {
      this.logger.warn(`Socket ${client.id} has no authenticated session`);
      client.disconnect(true);
      return false;
    }

    // The expiry timer disconnects the socket, but don't let a message slip
    // through in between (e.g. a delayed timer)
    if (auth.exp * 1000 <= Date.now()) {
      this.logger.debug(`Socket ${client.id} used an expired token`);
      client.emit(ServerEvents.SESSION_TERMINATED, {
        reason: 'TOKEN_EXPIRED',
      });
      client.disconnect(true);
      return false;
    }

    return true;
  }
}
