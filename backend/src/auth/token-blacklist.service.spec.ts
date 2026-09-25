import {
  ACCESS_TOKEN_TTL_SECONDS,
  TokenBlacklistService,
} from './token-blacklist.service';
import { createMockRedis, MockRedisClient } from '@/test-utils/mocks';

describe('TokenBlacklistService', () => {
  let service: TokenBlacklistService;
  let redis: MockRedisClient;

  const now = () => Math.floor(Date.now() / 1000);

  beforeEach(() => {
    redis = createMockRedis();
    service = new TokenBlacklistService(redis as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('blacklist', () => {
    it('stores the jti for the rest of the token lifetime', async () => {
      await service.blacklist('jti-1', now() + 100);

      expect(redis.set).toHaveBeenCalledWith(
        'token:blacklist:jti-1',
        '1',
        'EX',
        expect.any(Number),
      );
      await expect(service.isBlacklisted('jti-1')).resolves.toBe(true);
    });

    it('skips tokens that already expired', async () => {
      await service.blacklist('jti-1', now() - 1);

      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('isRevoked', () => {
    it('is false for a token nothing revoked', async () => {
      await expect(
        service.isRevoked({ sub: 'user-1', jti: 'jti-1', sid: 's-1', iat: 1 }),
      ).resolves.toBe(false);
    });

    it('is true for a blacklisted jti', async () => {
      await service.blacklist('jti-1', now() + 100);

      await expect(
        service.isRevoked({ sub: 'user-1', jti: 'jti-1', iat: now() }),
      ).resolves.toBe(true);
      await expect(
        service.isRevoked({ sub: 'user-1', jti: 'jti-2', iat: now() }),
      ).resolves.toBe(false);
    });

    it('is true for every token of a revoked session', async () => {
      await service.revokeSession('session-1');

      expect(redis.set).toHaveBeenCalledWith(
        'token:revoked-session:session-1',
        '1',
        'EX',
        ACCESS_TOKEN_TTL_SECONDS,
      );
      await expect(
        service.isRevoked({ sub: 'user-1', jti: 'a', sid: 'session-1' }),
      ).resolves.toBe(true);
      await expect(
        service.isRevoked({ sub: 'user-1', jti: 'b', sid: 'session-2' }),
      ).resolves.toBe(false);
      // A token without a session id is not caught by a session revocation
      await expect(
        service.isRevoked({ sub: 'user-1', jti: 'c' }),
      ).resolves.toBe(false);
    });

    it('is true for tokens issued up to a user cutoff, false after it', async () => {
      jest.useFakeTimers({ now: new Date('2026-01-01T00:00:10Z') });
      const cutoff = now();
      await service.revokeAllUserTokens('user-1');

      expect(redis.set).toHaveBeenCalledWith(
        'token:revoked-user:user-1',
        String(cutoff),
        'EX',
        ACCESS_TOKEN_TTL_SECONDS,
      );
      await expect(
        service.isRevoked({ sub: 'user-1', iat: cutoff - 100 }),
      ).resolves.toBe(true);
      // Same second: can't tell before from after, so revoked
      await expect(
        service.isRevoked({ sub: 'user-1', iat: cutoff }),
      ).resolves.toBe(true);
      await expect(
        service.isRevoked({ sub: 'user-1', iat: cutoff + 1 }),
      ).resolves.toBe(false);
      // Without iat a token can't prove it is newer
      await expect(service.isRevoked({ sub: 'user-1' })).resolves.toBe(true);
      // Other users are unaffected
      await expect(
        service.isRevoked({ sub: 'user-2', iat: cutoff - 100 }),
      ).resolves.toBe(false);
    });

    it('says what revoked the token', async () => {
      await expect(
        service.revocationOf({ sub: 'user-1', jti: 'j', sid: 's', iat: 1 }),
      ).resolves.toBeNull();

      await service.revokeAllUserTokens('user-1');
      await expect(
        service.revocationOf({ sub: 'user-1', jti: 'j', sid: 's', iat: 1 }),
      ).resolves.toBe('user');

      await service.revokeSession('s');
      await expect(
        service.revocationOf({ sub: 'user-1', jti: 'j', sid: 's', iat: 1 }),
      ).resolves.toBe('session');

      // The jti (logout) first
      await service.blacklist('j', now() + 100);
      await expect(
        service.revocationOf({ sub: 'user-1', jti: 'j', sid: 's', iat: 1 }),
      ).resolves.toBe('token');
    });

    it('checks everything in one round trip', async () => {
      await service.isRevoked({ sub: 'user-1', jti: 'j', sid: 's', iat: 1 });

      expect(redis.mget).toHaveBeenCalledTimes(1);
      expect(redis.mget).toHaveBeenCalledWith(
        'token:blacklist:j',
        'token:revoked-session:s',
        'token:revoked-user:user-1',
      );
    });
  });
});
