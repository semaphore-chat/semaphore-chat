import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request as ExpressRequest } from 'express';
import { Socket } from 'socket.io';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthenticatedSocket } from '@/common/utils/socket.utils';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Since Nest 12, global guards (this one is the APP_GUARD) also run for
    // WebSocket gateway handlers. Gateways authenticate the socket on connect
    // (RoomsGateway's middleware reads the token from the handshake `auth`
    // payload, where the web client sends it, and sets handshake.user), and
    // Passport's JWT strategy here only reads the Authorization header, so it
    // would reject every message from an authenticated web client. Accept
    // sockets the middleware already authenticated, like WsJwtAuthGuard does.
    if (context.getType() === 'ws') {
      const client = context.switchToWs().getClient<AuthenticatedSocket>();
      if (client?.handshake?.user) {
        return true;
      }
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  // Support extracting JWT from WebSocket handshake
  // Return type is `unknown` (not `Record<string, any>`) because this
  // genuinely returns different shapes depending on transport (an Express
  // Request for http, a handshake-like object for ws) — Passport's base
  // `getRequest` is itself typed `any`, so callers already treat the result
  // opaquely.
  getRequest(context: ExecutionContext): unknown {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<ExpressRequest>();
      return req;
    }
    if (context.getType() === 'ws') {
      const client = context.switchToWs().getClient<Socket>();
      if (
        client &&
        typeof client === 'object' &&
        'handshake' in client &&
        typeof client.handshake === 'object'
      ) {
        const handshake = client.handshake as {
          headers?: Record<string, string>;
          query?: Record<string, string>;
        };
        const authHeader = handshake.headers?.authorization;
        if (
          authHeader &&
          typeof authHeader === 'string' &&
          authHeader.startsWith('Bearer ')
        ) {
          return handshake;
        }
        if (
          handshake.query?.token &&
          typeof handshake.query.token === 'string'
        ) {
          handshake.headers = handshake.headers || {};
          handshake.headers.authorization = `Bearer ${handshake.query.token}`;
          return handshake;
        }
        return handshake;
      }
      return {};
    }
    return {};
  }
}
