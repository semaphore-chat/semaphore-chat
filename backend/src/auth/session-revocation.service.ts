import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { SessionTerminatedReason } from '@semaphore-chat/shared';
import {
  AuthSessionsRevokedEvent,
  AuthUserSessionsEndedEvent,
  RoomEvents,
} from '@/rooms/room-subscription.events';
import { TokenBlacklistService } from './token-blacklist.service';

/**
 * Ends sessions everywhere they live: revokes the access tokens (REST and new
 * socket connections reject them from then on) and tells the WebSocket layer
 * to disconnect the sockets authenticated with them (a domain event, handled
 * by SessionRevocationHandler, which reaches every instance through the
 * Socket.IO Redis adapter).
 *
 * Refresh tokens are the caller's business: delete them first, so the
 * session can't mint new access tokens.
 */
@Injectable()
export class SessionRevocationService {
  private readonly logger = new Logger(SessionRevocationService.name);

  constructor(
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Revoke sessions (refresh token families) whose refresh tokens are gone,
   * and disconnect their sockets. `tokenIds` covers access tokens issued
   * before tokens carried a session id; blacklist those separately (that
   * needs their expiry).
   */
  async revokeSessions(
    userId: string,
    sessionIds: string[],
    reason: SessionTerminatedReason,
    tokenIds: string[] = [],
  ): Promise<void> {
    const uniqueSessionIds = [...new Set(sessionIds)];
    await Promise.all(
      uniqueSessionIds.map((sid) =>
        this.tokenBlacklistService.revokeSession(sid),
      ),
    );

    if (uniqueSessionIds.length === 0 && tokenIds.length === 0) return;

    const event: AuthSessionsRevokedEvent = {
      userId,
      sessionIds: uniqueSessionIds,
      tokenIds: [...new Set(tokenIds)],
      reason,
    };
    this.eventEmitter.emit(RoomEvents.AUTH_SESSIONS_REVOKED, event);
    this.logger.log(
      `Revoked ${uniqueSessionIds.length} session(s) of user ${userId} (${reason})`,
    );
  }

  /**
   * Revoke every access token the user holds (their refresh tokens must be
   * gone already) and disconnect all of their sockets.
   */
  async revokeAllUserSessions(
    userId: string,
    reason: SessionTerminatedReason,
  ): Promise<void> {
    await this.tokenBlacklistService.revokeAllUserTokens(userId);
    this.endAllUserSockets(userId, reason);
  }

  /**
   * Disconnect all of the user's sockets without revoking tokens, for when
   * authentication already rejects the user (banned, deleted).
   */
  endAllUserSockets(userId: string, reason: SessionTerminatedReason): void {
    const event: AuthUserSessionsEndedEvent = { userId, reason };
    this.eventEmitter.emit(RoomEvents.AUTH_USER_SESSIONS_ENDED, event);
    this.logger.log(`Ending all sockets of user ${userId} (${reason})`);
  }
}
