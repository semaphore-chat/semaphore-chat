import { Injectable } from '@nestjs/common';
import type { SessionTerminatedReason } from '@semaphore-chat/shared';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '@/user/user.service';
import { UserEntity } from '@/user/dto/user-response.dto';
import {
  AccessTokenClaims,
  TokenBlacklistService,
} from './token-blacklist.service';

/** Why a socket token was rejected (never sent to the client). */
export class WsAuthError extends Error {
  constructor(
    readonly code:
      | 'INVALID_TOKEN'
      | 'TOKEN_REVOKED'
      | 'USER_NOT_FOUND'
      | 'USER_BANNED',
  ) {
    super(code);
    this.name = 'WsAuthError';
  }
}

export interface WsAuthResult {
  user: UserEntity;
  claims: AccessTokenClaims & { exp: number };
}

/**
 * Authenticates a WebSocket access token: the same checks JwtStrategy runs for
 * REST (signature and expiry, revocation, the user exists and isn't banned).
 * Shared by the connection middleware and REAUTHENTICATE.
 */
@Injectable()
export class WsAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {}

  /** @throws WsAuthError */
  async authenticate(token: string): Promise<WsAuthResult> {
    let claims: AccessTokenClaims;
    try {
      claims = this.jwtService.verify<AccessTokenClaims>(token);
    } catch {
      throw new WsAuthError('INVALID_TOKEN');
    }
    // Every token we sign expires; one that doesn't isn't ours.
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') {
      throw new WsAuthError('INVALID_TOKEN');
    }

    if (await this.tokenBlacklistService.isRevoked(claims)) {
      throw new WsAuthError('TOKEN_REVOKED');
    }

    // Narrowed select: this user object lives on the socket for the whole
    // connection — it must never hold sensitive columns.
    const user = await this.userService.findAuthUserById(claims.sub);
    if (!user) throw new WsAuthError('USER_NOT_FOUND');
    if (user.banned) throw new WsAuthError('USER_BANNED');

    return {
      user: new UserEntity(user),
      claims: { ...claims, exp: claims.exp },
    };
  }

  /**
   * Check a token that already authenticated once more: why its session has
   * ended since, or null if it is still valid. For sockets that joined their
   * revocation rooms after authenticating: a revocation in between missed
   * them, but it wrote its state (Redis, the user row) before it sent the
   * disconnect, so this sees it.
   */
  async sessionEndReason(
    claims: AccessTokenClaims,
  ): Promise<SessionTerminatedReason | null> {
    const [revocation, user] = await Promise.all([
      this.tokenBlacklistService.revocationOf(claims),
      this.userService.findAuthUserById(claims.sub),
    ]);

    if (!user) return 'ACCOUNT_DELETED';
    if (user.banned) return 'ACCOUNT_BANNED';
    switch (revocation) {
      case 'token':
        return 'LOGGED_OUT'; // only logout revokes a single access token
      case 'session':
        return 'SESSION_REVOKED';
      case 'user':
        return 'PASSWORD_CHANGED';
      default:
        return null;
    }
  }
}
