import { SignedUrlService } from './signed-url.service';
import { ConfigService } from '@nestjs/config';

describe('SignedUrlService', () => {
  let service: SignedUrlService;

  const mockConfigService = (overrides: Record<string, string | undefined> = {}) => {
    return {
      get: jest.fn((key: string) => {
        if (key in overrides) return overrides[key];
        if (key === 'JWT_SECRET') return 'test-jwt-secret';
        return undefined;
      }),
    } as unknown as ConfigService;
  };

  beforeEach(() => {
    service = new SignedUrlService(mockConfigService());
  });

  describe('constructor', () => {
    it('should use FILE_SIGNING_SECRET when available', () => {
      const svc = new SignedUrlService(
        mockConfigService({ FILE_SIGNING_SECRET: 'file-secret' }),
      );
      expect(svc).toBeDefined();
    });

    it('should fall back to JWT_SECRET when FILE_SIGNING_SECRET is not set', () => {
      const svc = new SignedUrlService(
        mockConfigService({ FILE_SIGNING_SECRET: undefined }),
      );
      expect(svc).toBeDefined();
    });

    it('should throw when neither secret is set', () => {
      expect(() => {
        new SignedUrlService(
          mockConfigService({
            FILE_SIGNING_SECRET: undefined,
            JWT_SECRET: undefined,
          }),
        );
      }).toThrow('JWT_SECRET or FILE_SIGNING_SECRET must be set');
    });

    it('should produce different signatures with different secrets', () => {
      const svc1 = new SignedUrlService(
        mockConfigService({ FILE_SIGNING_SECRET: 'secret-a' }),
      );
      const svc2 = new SignedUrlService(
        mockConfigService({ FILE_SIGNING_SECRET: 'secret-b' }),
      );

      const sig1 = svc1.sign('file1', 'user1', 1000000);
      const sig2 = svc2.sign('file1', 'user1', 1000000);
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('sign', () => {
    it('should return a hex string', () => {
      const sig = service.sign('file-123', 'user-456', 9999999999);
      expect(sig).toMatch(/^[0-9a-f]+$/);
    });

    it('should return a 64-character SHA-256 hex digest', () => {
      const sig = service.sign('file-123', 'user-456', 9999999999);
      expect(sig).toHaveLength(64);
    });

    it('should produce deterministic output', () => {
      const sig1 = service.sign('file-123', 'user-456', 9999999999);
      const sig2 = service.sign('file-123', 'user-456', 9999999999);
      expect(sig1).toBe(sig2);
    });

    it('should produce different signatures for different fileIds', () => {
      const sig1 = service.sign('file-a', 'user-1', 9999999999);
      const sig2 = service.sign('file-b', 'user-1', 9999999999);
      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different userIds', () => {
      const sig1 = service.sign('file-1', 'user-a', 9999999999);
      const sig2 = service.sign('file-1', 'user-b', 9999999999);
      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different expiresAt', () => {
      const sig1 = service.sign('file-1', 'user-1', 1000000);
      const sig2 = service.sign('file-1', 'user-1', 2000000);
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verify', () => {
    it('should return true for a valid signature with future expiry', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const sig = service.sign('file-1', 'user-1', exp);
      expect(service.verify('file-1', sig, exp, 'user-1')).toBe(true);
    });

    it('should return false for an expired signature', () => {
      const exp = Math.floor(Date.now() / 1000) - 60;
      const sig = service.sign('file-1', 'user-1', exp);
      expect(service.verify('file-1', sig, exp, 'user-1')).toBe(false);
    });

    it('should return false for a tampered signature', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const sig = service.sign('file-1', 'user-1', exp);
      const tampered = sig.replace(sig[0], sig[0] === 'a' ? 'b' : 'a');
      expect(service.verify('file-1', tampered, exp, 'user-1')).toBe(false);
    });

    it('should return false when fileId does not match', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const sig = service.sign('file-1', 'user-1', exp);
      expect(service.verify('file-2', sig, exp, 'user-1')).toBe(false);
    });

    it('should return false when userId does not match', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const sig = service.sign('file-1', 'user-1', exp);
      expect(service.verify('file-1', sig, exp, 'user-2')).toBe(false);
    });

    it('should return false when exp does not match', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const sig = service.sign('file-1', 'user-1', exp);
      expect(service.verify('file-1', sig, exp + 1, 'user-1')).toBe(false);
    });

    it('should return false for a signature with wrong length', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      expect(service.verify('file-1', 'short', exp, 'user-1')).toBe(false);
    });

    it('should return false for non-hex signature of correct length', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const nonHex = 'g'.repeat(64);
      expect(service.verify('file-1', nonHex, exp, 'user-1')).toBe(false);
    });
  });

  describe('generateSignedUrl', () => {
    it('should return a URL with sig, exp, and uid params', () => {
      const { url } = service.generateSignedUrl(
        '/api/file/file-1',
        'file-1',
        'user-1',
      );

      expect(url).toContain('/api/file/file-1?');
      expect(url).toMatch(/sig=[0-9a-f]{64}/);
      expect(url).toMatch(/exp=\d+/);
      expect(url).toContain('uid=user-1');
    });

    it('should return an expiresAt Date', () => {
      const { expiresAt } = service.generateSignedUrl(
        '/api/file/file-1',
        'file-1',
        'user-1',
      );

      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should default to 1 hour TTL', () => {
      const before = Math.floor(Date.now() / 1000) + 3600;
      const { expiresAt } = service.generateSignedUrl(
        '/api/file/file-1',
        'file-1',
        'user-1',
      );
      const after = Math.floor(Date.now() / 1000) + 3600;

      const expSeconds = Math.floor(expiresAt.getTime() / 1000);
      expect(expSeconds).toBeGreaterThanOrEqual(before);
      expect(expSeconds).toBeLessThanOrEqual(after);
    });

    it('should accept custom TTL', () => {
      const before = Math.floor(Date.now() / 1000) + 300;
      const { expiresAt } = service.generateSignedUrl(
        '/api/file/file-1',
        'file-1',
        'user-1',
        300,
      );
      const after = Math.floor(Date.now() / 1000) + 300;

      const expSeconds = Math.floor(expiresAt.getTime() / 1000);
      expect(expSeconds).toBeGreaterThanOrEqual(before);
      expect(expSeconds).toBeLessThanOrEqual(after);
    });

    it('should produce a URL whose signature passes verify', () => {
      const { url } = service.generateSignedUrl(
        '/api/file/file-1',
        'file-1',
        'user-1',
      );

      const parsed = new URL(url, 'http://localhost');
      const sig = parsed.searchParams.get('sig')!;
      const exp = parseInt(parsed.searchParams.get('exp')!, 10);
      const uid = parsed.searchParams.get('uid')!;

      expect(service.verify('file-1', sig, exp, uid)).toBe(true);
    });
  });
});
