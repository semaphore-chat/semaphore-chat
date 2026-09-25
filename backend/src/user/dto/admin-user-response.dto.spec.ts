import { instanceToPlain } from 'class-transformer';
import { AdminUserEntity } from './admin-user-response.dto';
import { InstanceRole } from '@prisma/client';

describe('AdminUserEntity', () => {
  describe('BigInt serialization', () => {
    it('should transform storageQuotaBytes BigInt to Number', () => {
      const user = new AdminUserEntity({
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
        verified: true,
        role: InstanceRole.USER,
        createdAt: new Date(),
        avatarUrl: null,
        bannerUrl: null,
        lastSeen: null,
        displayName: 'Test User',
        bio: null,
        status: null,
        statusUpdatedAt: null,
        banned: false,
        bannedAt: null,
        bannedById: null,
        storageQuotaBytes: BigInt(53687091200), // 50GB
        storageUsedBytes: BigInt(1073741824), // 1GB
        hashedPassword: 'hashed',
      });

      const plain = instanceToPlain(user);

      expect(typeof plain.storageQuotaBytes).toBe('number');
      expect(plain.storageQuotaBytes).toBe(53687091200);
      expect(typeof plain.storageUsedBytes).toBe('number');
      expect(plain.storageUsedBytes).toBe(1073741824);
    });

    it('should handle zero BigInt values', () => {
      const user = new AdminUserEntity({
        id: 'user-123',
        username: 'testuser',
        storageQuotaBytes: BigInt(0),
        storageUsedBytes: BigInt(0),
      });

      const plain = instanceToPlain(user);

      expect(plain.storageQuotaBytes).toBe(0);
      expect(plain.storageUsedBytes).toBe(0);
    });

    it('should handle null/undefined BigInt values gracefully', () => {
      const user = new AdminUserEntity({
        id: 'user-123',
        username: 'testuser',
        storageQuotaBytes: null as any,
        storageUsedBytes: undefined,
      });

      const plain = instanceToPlain(user);

      expect(plain.storageQuotaBytes).toBe(0);
      expect(plain.storageUsedBytes).toBe(0);
    });

    it('should exclude hashedPassword from serialization', () => {
      const user = new AdminUserEntity({
        id: 'user-123',
        username: 'testuser',
        hashedPassword: 'secret-hash',
        storageQuotaBytes: BigInt(0),
        storageUsedBytes: BigInt(0),
      });

      const plain = instanceToPlain(user);

      expect(plain.hashedPassword).toBeUndefined();
    });

    it('should serialize to valid JSON without BigInt errors', () => {
      const user = new AdminUserEntity({
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
        verified: true,
        role: InstanceRole.OWNER,
        createdAt: new Date('2024-01-01'),
        avatarUrl: null,
        bannerUrl: null,
        lastSeen: new Date('2024-01-02'),
        displayName: 'Test User',
        bio: 'Bio text',
        status: 'online',
        statusUpdatedAt: new Date('2024-01-02'),
        banned: false,
        bannedAt: null,
        bannedById: null,
        storageQuotaBytes: BigInt(107374182400), // 100GB
        storageUsedBytes: BigInt(5368709120), // 5GB
        hashedPassword: 'hashed',
      });

      const plain = instanceToPlain(user);

      // This should not throw "Do not know how to serialize a BigInt"
      expect(() => JSON.stringify(plain)).not.toThrow();

      const json = JSON.stringify(plain);
      const parsed = JSON.parse(json);

      expect(parsed.storageQuotaBytes).toBe(107374182400);
      expect(parsed.storageUsedBytes).toBe(5368709120);
      expect(parsed.hashedPassword).toBeUndefined();
    });
  });
});
