import { TestBed } from '@suites/unit';
import { ConfigService } from '@nestjs/config';
import { LivekitAccessService } from './livekit-access.service';
import { DatabaseService } from '@/database/database.service';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import { createMockConfigService } from '@/test-utils';
import {
  LIVEKIT_ISSUED_AT_ATTRIBUTE,
  signIssuedAt,
} from './livekit-token-issued-at.util';

describe('LivekitAccessService', () => {
  let service: LivekitAccessService;
  const secret = 'test-api-secret';
  const cutoff = 1_760_000_000_000;

  const mockRedis = { get: jest.fn(), set: jest.fn() };
  const mockDatabase = { user: { findUnique: jest.fn() } };

  const attrs = (identity: string, issuedAtMs: number) => ({
    [LIVEKIT_ISSUED_AT_ATTRIBUTE]: signIssuedAt(secret, identity, issuedAtMs),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
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

      await expect(service.checkJoin('user-1', {})).resolves.toBe(
        'USER_DELETED',
      );
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
});
