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

    describe('user cutoff (#562)', () => {
      // 10.400 s into the minute: the cutoff falls inside a second
      const cutoffMs = Date.parse('2026-01-01T00:00:10.400Z');
      const cutoffS = Math.floor(cutoffMs / 1000);

      beforeEach(async () => {
        jest.useFakeTimers({ now: cutoffMs });
        await service.revokeAllUserTokens('user-1');
      });

      it('stores the cutoff in ms, and in seconds for older instances', () => {
        expect(redis.set).toHaveBeenCalledWith(
          'token:revoked-user-ms:user-1',
          String(cutoffMs),
          'EX',
          ACCESS_TOKEN_TTL_SECONDS,
        );
        expect(redis.set).toHaveBeenCalledWith(
          'token:revoked-user:user-1',
          String(cutoffS),
          'EX',
          ACCESS_TOKEN_TTL_SECONDS,
        );
      });

      it('does not revoke a token issued later in the same second', async () => {
        await expect(
          service.isRevoked({
            sub: 'user-1',
            iat: cutoffS,
            iatMs: cutoffMs + 1,
          }),
        ).resolves.toBe(false);
      });

      it('revokes tokens issued before or at the cutoff', async () => {
        await expect(
          service.isRevoked({
            sub: 'user-1',
            iat: cutoffS,
            iatMs: cutoffMs - 1,
          }),
        ).resolves.toBe(true);
        await expect(
          service.isRevoked({ sub: 'user-1', iat: cutoffS, iatMs: cutoffMs }),
        ).resolves.toBe(true);
        await expect(
          service.isRevoked({
            sub: 'user-1',
            iat: cutoffS - 100,
            iatMs: cutoffMs - 100_000,
          }),
        ).resolves.toBe(true);
      });

      it('judges a token without iatMs by seconds, as before', async () => {
        await expect(
          service.isRevoked({ sub: 'user-1', iat: cutoffS - 100 }),
        ).resolves.toBe(true);
        // Same second: can't tell before from after, so revoked
        await expect(
          service.isRevoked({ sub: 'user-1', iat: cutoffS }),
        ).resolves.toBe(true);
        await expect(
          service.isRevoked({ sub: 'user-1', iat: cutoffS + 1 }),
        ).resolves.toBe(false);
        // Without iat a token can't prove it is newer
        await expect(service.isRevoked({ sub: 'user-1' })).resolves.toBe(true);
      });

      it('leaves other users alone', async () => {
        await expect(
          service.isRevoked({ sub: 'user-2', iat: cutoffS - 100, iatMs: 1 }),
        ).resolves.toBe(false);
      });
    });

    describe('a cutoff in seconds from before #562', () => {
      const cutoffS = 1_767_225_610;

      beforeEach(async () => {
        // As an older instance (or this one before the deploy) wrote it
        await redis.set('token:revoked-user:user-1', String(cutoffS));
      });

      it('revokes tokens up to the end of that second', async () => {
        await expect(
          service.isRevoked({ sub: 'user-1', iat: cutoffS }),
        ).resolves.toBe(true);
        await expect(
          service.isRevoked({
            sub: 'user-1',
            iat: cutoffS,
            iatMs: cutoffS * 1000 + 999,
          }),
        ).resolves.toBe(true);
      });

      it('lets later tokens through', async () => {
        await expect(
          service.isRevoked({ sub: 'user-1', iat: cutoffS + 1 }),
        ).resolves.toBe(false);
        await expect(
          service.isRevoked({
            sub: 'user-1',
            iat: cutoffS + 1,
            iatMs: (cutoffS + 1) * 1000,
          }),
        ).resolves.toBe(false);
      });
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
        'token:revoked-user-ms:user-1',
        'token:revoked-user:user-1',
      );
    });
  });
});
