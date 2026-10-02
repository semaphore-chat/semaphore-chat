import { TestBed } from '@suites/unit';
import { ConfigService } from '@nestjs/config';
import { LivekitAccessService } from './livekit-access.service';
import { DatabaseService } from '@/database/database.service';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import { createMockConfigService } from '@/test-utils';
import {
  LIVEKIT_ISSUED_AT_ATTRIBUTE,
  LIVEKIT_SESSION_ATTRIBUTE,
  signIssuedAt,
  signSessionId,
} from './livekit-token-attributes.util';

describe('LivekitAccessService', () => {
  let service: LivekitAccessService;
  const secret = 'test-api-secret';
  const cutoff = 1_760_000_000_000;

  const mockRedis = { get: jest.fn(), set: jest.fn(), mget: jest.fn() };
  const mockDatabase = { user: { findUnique: jest.fn() } };

  const attrs = (identity: string, issuedAtMs: number) => ({
    [LIVEKIT_ISSUED_AT_ATTRIBUTE]: signIssuedAt(secret, identity, issuedAtMs),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.mget.mockResolvedValue([null, null]);
    mockDatabase.user.findUnique.mockResolvedValue({ banned: false });

    const { unit } = await TestBed.solitary(LivekitAccessService)
      .mock(ConfigService)
      .final(createMockConfigService({ LIVEKIT_API_SECRET: secret }))
      .mock(DatabaseService)
      .final(mockDatabase)
      .mock(REDIS_CLIENT)
      .final(mockRedis)
      .compile();

    service = unit;
  });

  describe('revokeTokensIssuedBefore', () => {
    it('stores the cutoff for longer than a LiveKit token lives', async () => {
      await service.revokeTokensIssuedBefore('user-1', cutoff);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'livekit:token_cutoff:user-1',
        String(cutoff),
        'EX',
        expect.any(Number),
      );
      const ttl = mockRedis.set.mock.calls[0][3] as number;
      expect(ttl).toBeGreaterThan(3600);
    });
  });

  describe('checkJoin', () => {
    it('allows a normal user with no cutoff', async () => {
      await expect(service.checkJoin('user-1', {})).resolves.toBeNull();

      // One primary-key read, selecting no sensitive fields
      expect(mockDatabase.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { banned: true },
      });
      expect(mockRedis.get).toHaveBeenCalledWith('livekit:token_cutoff:user-1');
    });

    it('denies a deleted user', async () => {
      mockDatabase.user.findUnique.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue(String(Date.now()));

      await expect(service.checkJoin('user-1', {})).resolves.toBe(
        'USER_DELETED',
      );
    });

    it('allows an identity that was never a user (no cutoff)', async () => {
      mockDatabase.user.findUnique.mockResolvedValue(null);

      await expect(service.checkJoin('test-bot', {})).resolves.toBeNull();
    });

    it('denies a banned user', async () => {
      mockDatabase.user.findUnique.mockResolvedValue({ banned: true });

      await expect(
        service.checkJoin('user-1', attrs('user-1', cutoff + 1000)),
      ).resolves.toBe('USER_BANNED');
    });

    it('denies a token issued before the cutoff', async () => {
      mockRedis.get.mockResolvedValue(String(cutoff));

      await expect(
        service.checkJoin('user-1', attrs('user-1', cutoff - 1)),
      ).resolves.toBe('TOKEN_REVOKED');
      await expect(
        service.checkJoin('user-1', attrs('user-1', cutoff)),
      ).resolves.toBe('TOKEN_REVOKED');
    });

    it('allows a token issued after the cutoff', async () => {
      mockRedis.get.mockResolvedValue(String(cutoff));

      await expect(
        service.checkJoin('user-1', attrs('user-1', cutoff + 1)),
      ).resolves.toBeNull();
    });

    it('denies a token without a valid issue time while a cutoff is in force', async () => {
      mockRedis.get.mockResolvedValue(String(cutoff));

      await expect(service.checkJoin('user-1', undefined)).resolves.toBe(
        'TOKEN_REVOKED',
      );
      // Forged: a later time with no valid signature
      await expect(
        service.checkJoin('user-1', {
          [LIVEKIT_ISSUED_AT_ATTRIBUTE]: `${cutoff + 60_000}.forged`,
        }),
      ).resolves.toBe('TOKEN_REVOKED');
      // Copied from another identity's token
      await expect(
        service.checkJoin('user-1', attrs('user-2', cutoff + 60_000)),
      ).resolves.toBe('TOKEN_REVOKED');
    });

    it('ignores the issue time when there is no cutoff', async () => {
      await expect(service.checkJoin('user-1', undefined)).resolves.toBeNull();
    });

    it('fails open when the lookups fail', async () => {
      mockDatabase.user.findUnique.mockRejectedValue(new Error('db down'));

      await expect(service.checkJoin('user-1', {})).resolves.toBeNull();
    });
  });

  describe('sessions', () => {
    const sessionAttrs = (identity: string, sessionId: string) => ({
      [LIVEKIT_SESSION_ATTRIBUTE]: signSessionId(secret, identity, sessionId),
    });

    it('reads the session of a validly signed attribute', () => {
      expect(service.sessionOf('user-1', sessionAttrs('user-1', 's-A'))).toBe(
        's-A',
      );
    });

    it('treats a forged or copied session attribute as absent', () => {
      expect(
        service.sessionOf('user-1', {
          [LIVEKIT_SESSION_ATTRIBUTE]: 's-A.forged',
        }),
      ).toBeNull();
      expect(
        service.sessionOf('user-1', sessionAttrs('user-2', 's-A')),
      ).toBeNull();
      expect(service.sessionOf('user-1', undefined)).toBeNull();
    });

    it("denies a revoked session's token (one Redis round trip)", async () => {
      mockRedis.mget.mockResolvedValue([null, '1']);

      await expect(
        service.checkJoin('user-1', sessionAttrs('user-1', 's-A')),
      ).resolves.toBe('SESSION_REVOKED');
      expect(mockRedis.mget).toHaveBeenCalledWith(
        'livekit:token_cutoff:user-1',
        'token:revoked-session:s-A',
      );
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it("allows an active session's token", async () => {
      await expect(
        service.checkJoin('user-1', sessionAttrs('user-1', 's-B')),
      ).resolves.toBeNull();
    });

    it('allows a token without a session attribute', async () => {
      await expect(
        service.checkJoin('user-1', attrs('user-1', cutoff)),
      ).resolves.toBeNull();
      expect(mockRedis.mget).not.toHaveBeenCalled();
    });

    it('treats a forged session attribute as absent (allowed, nothing looked up)', async () => {
      await expect(
        service.checkJoin('user-1', {
          [LIVEKIT_SESSION_ATTRIBUTE]: 's-A.forged',
        }),
      ).resolves.toBeNull();
      expect(mockRedis.mget).not.toHaveBeenCalled();
    });

    it('still applies the user-wide cutoff to a token with an active session', async () => {
      mockRedis.mget.mockResolvedValue([String(cutoff), null]);

      await expect(
        service.checkJoin('user-1', {
          ...sessionAttrs('user-1', 's-A'),
          ...attrs('user-1', cutoff - 1),
        }),
      ).resolves.toBe('TOKEN_REVOKED');
    });

    it('fails open when Redis fails', async () => {
      mockRedis.mget.mockRejectedValue(new Error('Redis down'));

      await expect(
        service.checkJoin('user-1', sessionAttrs('user-1', 's-A')),
      ).resolves.toBeNull();
    });
  });
});
