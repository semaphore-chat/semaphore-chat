import type Redis from 'ioredis';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import {
  REFRESH_TOKEN_REUSE_GRACE_MS,
  RefreshTokenGraceService,
} from './refresh-token-grace.service';

describe('RefreshTokenGraceService', () => {
  let store: Map<string, string>;
  let redis: { set: jest.Mock; get: jest.Mock };
  let service: RefreshTokenGraceService;

  beforeEach(() => {
    store = new Map();
    redis = {
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    };
    service = new RefreshTokenGraceService(redis as unknown as Redis);
  });

  describe('isWithinGraceWindow', () => {
    const nowMs = 1_700_000_000_000;
    const now = new Date(nowMs);

    it('accepts a rotation within the window', () => {
      expect(service.isWithinGraceWindow(new Date(nowMs - 1000), now)).toBe(
        true,
      );
      expect(
        service.isWithinGraceWindow(
          new Date(nowMs - REFRESH_TOKEN_REUSE_GRACE_MS),
          now,
        ),
      ).toBe(true);
    });

    it('refuses a rotation past the window, or none', () => {
      expect(
        service.isWithinGraceWindow(
          new Date(nowMs - REFRESH_TOKEN_REUSE_GRACE_MS - 1),
          now,
        ),
      ).toBe(false);
      expect(service.isWithinGraceWindow(null, now)).toBe(false);
    });

    it('accepts a rotation stamped by a clock ahead of this one', () => {
      // Clock skew is no sign of a stolen token
      expect(service.isWithinGraceWindow(new Date(nowMs + 1000), now)).toBe(
        true,
      );
      expect(service.isWithinGraceWindow(new Date(nowMs + 60_000), now)).toBe(
        true,
      );
    });

    it('is a short window', () => {
      expect(REFRESH_TOKEN_REUSE_GRACE_MS).toBeGreaterThanOrEqual(10_000);
      expect(REFRESH_TOKEN_REUSE_GRACE_MS).toBeLessThanOrEqual(30_000);
    });
  });

  describe('remember / recall', () => {
    it('returns the successor to whoever presents the rotated token', async () => {
      await service.remember('jti-0', 'old-token', 'new-token');

      await expect(service.recall('jti-0', 'old-token')).resolves.toBe(
        'new-token',
      );
    });

    it('keeps it a little longer than the grace window', async () => {
      await service.remember('jti-0', 'old-token', 'new-token');

      const [key, , mode, ttl] = redis.set.mock.calls[0] as [
        string,
        string,
        string,
        number,
      ];
      expect(key).toBe('auth:refresh-successor:jti-0');
      expect(mode).toBe('EX');
      expect(ttl * 1000).toBeGreaterThan(REFRESH_TOKEN_REUSE_GRACE_MS);
      expect(ttl * 1000).toBeLessThanOrEqual(
        REFRESH_TOKEN_REUSE_GRACE_MS + 10_000,
      );
    });

    it('stores the successor encrypted, not readable from Redis alone', async () => {
      await service.remember('jti-0', 'old-token', 'new-token');

      const stored = store.get('auth:refresh-successor:jti-0')!;
      expect(stored).not.toContain('new-token');
      expect(Buffer.from(stored, 'base64').toString('utf8')).not.toContain(
        'new-token',
      );
    });

    it('returns nothing for another token with the same id', async () => {
      await service.remember('jti-0', 'old-token', 'new-token');

      await expect(service.recall('jti-0', 'forged-token')).resolves.toBeNull();
    });

    it('returns nothing when nothing was remembered, or it was tampered with', async () => {
      await expect(service.recall('jti-0', 'old-token')).resolves.toBeNull();

      store.set('auth:refresh-successor:jti-0', 'bm90IGEgY2lwaGVydGV4dA==');
      await expect(service.recall('jti-0', 'old-token')).resolves.toBeNull();
    });

    it('rejects a truncated authentication tag', async () => {
      // A valid tag for an empty message, cut to 4 bytes (which GCM would
      // otherwise accept as a shorter tag)
      const key = createHash('sha256')
        .update('semaphore:refresh-successor\0')
        .update('old-token')
        .digest();
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.final();
      const truncated = cipher.getAuthTag().subarray(0, 4);
      store.set(
        'auth:refresh-successor:jti-0',
        Buffer.concat([iv, truncated]).toString('base64'),
      );

      await expect(service.recall('jti-0', 'old-token')).resolves.toBeNull();
    });
  });
});
