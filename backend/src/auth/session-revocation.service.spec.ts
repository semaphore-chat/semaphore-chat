import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SessionRevocationService } from './session-revocation.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { RoomEvents } from '@/rooms/room-subscription.events';

describe('SessionRevocationService', () => {
  let service: SessionRevocationService;
  let tokenBlacklistService: Mocked<TokenBlacklistService>;
  let eventEmitter: Mocked<EventEmitter2>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      SessionRevocationService,
    ).compile();

    service = unit;
    tokenBlacklistService = unitRef.get(TokenBlacklistService);
    eventEmitter = unitRef.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('revokeSessions', () => {
    it('revokes each session once, then disconnects sessions and tokens', async () => {
      await service.revokeSessions(
        'user-1',
        ['s-1', 's-2', 's-1'],
        'SESSION_REVOKED',
        ['jti-1'],
      );

      expect(tokenBlacklistService.revokeSession).toHaveBeenCalledTimes(2);
      expect(tokenBlacklistService.revokeSession).toHaveBeenCalledWith('s-1');
      expect(tokenBlacklistService.revokeSession).toHaveBeenCalledWith('s-2');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.AUTH_SESSIONS_REVOKED,
        {
          userId: 'user-1',
          sessionIds: ['s-1', 's-2'],
          tokenIds: ['jti-1'],
          reason: 'SESSION_REVOKED',
        },
      );
    });

    it('disconnects the sockets only after the tokens are revoked', async () => {
      const order: string[] = [];
      tokenBlacklistService.revokeSession.mockImplementation(async () => {
        await Promise.resolve();
        order.push('revoke');
      });
      eventEmitter.emit.mockImplementation(() => {
        order.push('emit');
        return true;
      });

      await service.revokeSessions('user-1', ['s-1'], 'LOGGED_OUT');

      // Otherwise a client could reconnect with the old token in between
      expect(order).toEqual(['revoke', 'emit']);
    });

    it('does nothing when there is nothing to revoke', async () => {
      await service.revokeSessions('user-1', [], 'SESSION_REVOKED');

      expect(tokenBlacklistService.revokeSession).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllUserSessions', () => {
    it('revokes all user tokens, then disconnects all user sockets', async () => {
      await service.revokeAllUserSessions('user-1', 'PASSWORD_CHANGED');

      expect(tokenBlacklistService.revokeAllUserTokens).toHaveBeenCalledWith(
        'user-1',
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.AUTH_USER_SESSIONS_ENDED,
        { userId: 'user-1', reason: 'PASSWORD_CHANGED' },
      );
    });
  });

  describe('endAllUserSockets', () => {
    it('disconnects all user sockets without revoking tokens', () => {
      service.endAllUserSockets('user-1', 'ACCOUNT_BANNED');

      expect(tokenBlacklistService.revokeAllUserTokens).not.toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.AUTH_USER_SESSIONS_ENDED,
        { userId: 'user-1', reason: 'ACCOUNT_BANNED' },
      );
    });
  });
});
