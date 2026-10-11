import type Redis from 'ioredis';
import { createHash } from 'crypto';
import {
  APPROVED_GRANT_TTL_SECONDS,
  DeviceLoginGrant,
  DeviceLoginGrantService,
} from './device-login-grant.service';
import type { AuthService } from './auth.service';
import type { TokenBlacklistService } from './token-blacklist.service';
import { DatabaseService } from '@/database/database.service';
import { UserFactory, createMockDatabase } from '@/test-utils';

const verifier = 'v'.repeat(43) + '-._~abc';
const challenge = createHash('sha256').update(verifier).digest('base64url');

const approver = {
  sub: 'user-1',
  sid: 'session-1',
  jti: 'jti-1',
  iat: 1_700_000_000,
  iatMs: 1_700_000_000_123,
};

const desktop = {
  userAgent: 'Mozilla/5.0 Electron/39',
  ipAddress: '10.0.0.2',
  deviceId: '6f1c2c86-1f1e-4c1a-9a51-6a6f1a3c2b11',
};

describe('DeviceLoginGrantService', () => {
  let store: Map<string, string>;
  let redis: { set: jest.Mock; eval: jest.Mock };
  let database: ReturnType<typeof createMockDatabase>;
  let authService: { issueLoginTokens: jest.Mock };
  let blacklist: { isRevoked: jest.Mock };
  let service: DeviceLoginGrantService;
  const user = UserFactory.build({ id: 'user-1', banned: false });

  beforeEach(() => {
    store = new Map();
    redis = {
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      // The Lua script's semantics: take an approved grant, leave others
      eval: jest.fn((_script: string, _keys: number, key: string) => {
        const value = store.get(key);
        if (!value) return Promise.resolve(null);
        const grant = JSON.parse(value) as DeviceLoginGrant;
        if (grant.status !== 'approved') return Promise.resolve(null);
        store.delete(key);
        return Promise.resolve(value);
      }),
    };
    database = createMockDatabase();
    database.user.findUnique.mockResolvedValue(user);
    database.refreshToken.findFirst.mockResolvedValue({ id: 'rt-1' });
    authService = {
      issueLoginTokens: jest
        .fn()
        .mockResolvedValue({ refreshToken: 'rt', accessToken: 'at' }),
    };
    blacklist = { isRevoked: jest.fn().mockResolvedValue(false) };
    service = new DeviceLoginGrantService(
      redis as unknown as Redis,
      database as unknown as DatabaseService,
      authService as unknown as AuthService,
      blacklist as unknown as TokenBlacklistService,
    );
  });

  describe('createApproved', () => {
    it('stores an approved grant under a hash of its id, with a short TTL', async () => {
      const { id, expiresInSeconds } = await service.createApproved(
        challenge,
        approver,
      );

      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(expiresInSeconds).toBe(APPROVED_GRANT_TTL_SECONDS);
      const [key, value, ex, ttl] = redis.set.mock.calls[0] as [
        string,
        string,
        string,
        number,
      ];
      // The raw id (the code) is never a key
      expect(key).not.toContain(id);
      expect(key).toBe(
        `auth:device-login-grant:${createHash('sha256').update(id).digest('hex')}`,
      );
      expect([ex, ttl]).toEqual(['EX', APPROVED_GRANT_TTL_SECONDS]);
      expect(JSON.parse(value)).toMatchObject({
        id,
        status: 'approved',
        codeChallenge: challenge,
        userId: 'user-1',
        approverFamilyId: 'session-1',
        approver: { jti: 'jti-1', iat: approver.iat, iatMs: approver.iatMs },
      });
    });

    it.each(['too-short', 'c'.repeat(44), `${'c'.repeat(42)}=`, ''])(
      'refuses a malformed challenge %p',
      async (bad) => {
        await expect(service.createApproved(bad, approver)).rejects.toThrow(
          'Invalid code challenge',
        );
        expect(redis.set).not.toHaveBeenCalled();
      },
    );

    it('mints a different code each time', async () => {
      const a = await service.createApproved(challenge, approver);
      const b = await service.createApproved(challenge, approver);
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('redeem', () => {
    it("issues a session for the redeeming device, not the approver's", async () => {
      const { id } = await service.createApproved(challenge, approver);

      const result = await service.redeem(id, verifier, desktop);

      expect(result).toEqual({
        ok: true,
        refreshToken: 'rt',
        accessToken: 'at',
        userId: 'user-1',
      });
      expect(authService.issueLoginTokens).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' }),
        desktop,
      );
    });

    it('is single use', async () => {
      const { id } = await service.createApproved(challenge, approver);
      await service.redeem(id, verifier, desktop);

      await expect(service.redeem(id, verifier, desktop)).resolves.toEqual({
        ok: false,
        reason: 'unknown-grant',
      });
      expect(authService.issueLoginTokens).toHaveBeenCalledTimes(1);
    });

    it('refuses a wrong verifier, and the code is spent', async () => {
      const { id } = await service.createApproved(challenge, approver);

      await expect(
        service.redeem(id, 'w'.repeat(43), desktop),
      ).resolves.toEqual({ ok: false, reason: 'wrong-verifier' });
      await expect(service.redeem(id, verifier, desktop)).resolves.toEqual({
        ok: false,
        reason: 'unknown-grant',
      });
      expect(authService.issueLoginTokens).not.toHaveBeenCalled();
    });

    it('refuses a malformed verifier', async () => {
      const { id } = await service.createApproved(challenge, approver);
      await expect(service.redeem(id, 'short', desktop)).resolves.toEqual({
        ok: false,
        reason: 'wrong-verifier',
      });
    });

    it('refuses an unknown or expired code', async () => {
      await expect(
        service.redeem('x'.repeat(43), verifier, desktop),
      ).resolves.toEqual({ ok: false, reason: 'unknown-grant' });
    });

    it("leaves a grant that isn't approved yet", async () => {
      const id = 'p'.repeat(43);
      const key = `auth:device-login-grant:${createHash('sha256').update(id).digest('hex')}`;
      const pending: DeviceLoginGrant = {
        id,
        status: 'pending',
        codeChallenge: challenge,
        requesterInfo: desktop,
        userId: null,
        approverFamilyId: null,
        approver: null,
        approvedAt: null,
      };
      store.set(key, JSON.stringify(pending));

      await expect(service.redeem(id, verifier, desktop)).resolves.toEqual({
        ok: false,
        reason: 'unknown-grant',
      });
      expect(store.has(key)).toBe(true);
    });

    it('refuses when the approving session is gone (logged out, revoked)', async () => {
      database.refreshToken.findFirst.mockResolvedValue(null);
      const { id } = await service.createApproved(challenge, approver);

      await expect(service.redeem(id, verifier, desktop)).resolves.toEqual({
        ok: false,
        reason: 'approver-revoked',
      });
      expect(database.refreshToken.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            familyId: 'session-1',
            consumed: false,
          }) as unknown,
        }),
      );
      expect(authService.issueLoginTokens).not.toHaveBeenCalled();
    });

    it('refuses when the approval was revoked since (password reset, session revocation)', async () => {
      blacklist.isRevoked.mockResolvedValue(true);
      const { id } = await service.createApproved(challenge, approver);

      await expect(service.redeem(id, verifier, desktop)).resolves.toEqual({
        ok: false,
        reason: 'approver-revoked',
      });
      expect(blacklist.isRevoked).toHaveBeenCalledWith({
        sub: 'user-1',
        sid: 'session-1',
        jti: 'jti-1',
        iat: approver.iat,
        iatMs: approver.iatMs,
      });
      expect(authService.issueLoginTokens).not.toHaveBeenCalled();
    });

    it('refuses a banned or deleted user', async () => {
      database.user.findUnique.mockResolvedValueOnce({ ...user, banned: true });
      const first = await service.createApproved(challenge, approver);
      await expect(
        service.redeem(first.id, verifier, desktop),
      ).resolves.toEqual({ ok: false, reason: 'user-unavailable' });

      database.user.findUnique.mockResolvedValueOnce(null);
      const second = await service.createApproved(challenge, approver);
      await expect(
        service.redeem(second.id, verifier, desktop),
      ).resolves.toEqual({ ok: false, reason: 'user-unavailable' });
      expect(authService.issueLoginTokens).not.toHaveBeenCalled();
    });
  });
});
