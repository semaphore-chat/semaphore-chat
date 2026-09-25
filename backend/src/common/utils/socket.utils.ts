import { Socket } from 'socket.io';
import { WsException } from '@nestjs/websockets';
import { UserEntity } from '@/user/dto/user-response.dto';

/**
 * Type for socket with authenticated user
 */
export type AuthenticatedSocket = Socket & {
  handshake: {
    user: UserEntity;
  };
};

/**
 * Type for socket with optional user (before auth verification)
 */
export type OptionalAuthSocket = Socket & {
  handshake: {
    user?: UserEntity;
  };
};

/**
 * The access token a socket is authenticated with, kept in `socket.data` (so
 * it is also visible through `fetchSockets()` on other instances).
 */
export interface SocketAuthData {
  userId: string;
  /** Access token id. */
  jti?: string;
  /** Session id (refresh token family). */
  sid?: string;
  /** Access token expiry (seconds since epoch). */
  exp: number;
}

/** The socket's access token data, if the connection middleware set it. */
export function getSocketAuth(client: Socket): SocketAuthData | undefined {
  const data = client.data as { auth?: SocketAuthData } | undefined;
  return data?.auth;
}

/**
 * Safely extracts the authenticated user from a socket connection.
 * Throws WsException if user is not authenticated.
 *
 * @param client - The socket client
 * @returns The authenticated user entity
 * @throws WsException if user is not attached to socket
 *
 * @example
 * ```typescript
 * @SubscribeMessage('someEvent')
 * async handleEvent(@ConnectedSocket() client: Socket) {
 *   const user = getSocketUser(client);
 *   // user is guaranteed to be defined here
 * }
 * ```
 */
export function getSocketUser(client: Socket): UserEntity {
  const handshake = client.handshake as { user?: UserEntity };
  const user = handshake.user;

  if (!user) {
    throw new WsException('User not authenticated');
  }

  return user;
}

/**
 * Safely extracts the user ID from a socket connection.
 * Throws WsException if user is not authenticated.
 *
 * @param client - The socket client
 * @returns The user ID
 * @throws WsException if user is not attached to socket
 */
export function getSocketUserId(client: Socket): string {
  return getSocketUser(client).id;
}

/**
 * Type guard to check if a socket has an authenticated user.
 *
 * @param client - The socket client
 * @returns True if user is authenticated
 */
export function isAuthenticated(client: Socket): client is AuthenticatedSocket {
  const handshake = client.handshake as { user?: UserEntity };
  return !!handshake.user;
}

interface SocketHandshakeLike {
  auth?: { token?: unknown };
  headers?: { authorization?: unknown };
}

/**
 * Extracts a JWT token from a socket handshake.
 *
 * Checks `auth.token` first, then falls back to `headers.authorization`.
 * Strips the `Bearer ` prefix if present.
 *
 * @returns The raw token string, or undefined if no token is found
 */
export function extractTokenFromHandshake(
  handshake: SocketHandshakeLike,
): string | undefined {
  let token: string | undefined =
    typeof handshake.auth?.token === 'string'
      ? handshake.auth.token
      : typeof handshake.headers?.authorization === 'string'
        ? handshake.headers.authorization
        : undefined;

  if (!token) return undefined;

  if (token.startsWith('Bearer ')) {
    token = token.split('Bearer ')[1];
  }

  return token || undefined;
}
