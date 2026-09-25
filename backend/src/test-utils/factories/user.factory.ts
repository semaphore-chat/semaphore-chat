import { User, InstanceRole } from '@prisma/client';

export class UserFactory {
  private static counter = 0;

  static build(overrides: Partial<User> = {}): User {
    const id = overrides.id || this.generateId();
    const username = overrides.username || `user${this.counter++}`;

    return {
      id,
      username,
      email: overrides.email || `${username}@example.com`,
      verified: overrides.verified ?? false,
      hashedPassword:
        overrides.hashedPassword || '$2b$10$dummyHashedPassword123',
      role: overrides.role || InstanceRole.USER,
      createdAt: overrides.createdAt || new Date(),
      avatarUrl: overrides.avatarUrl || null,
      bannerUrl: overrides.bannerUrl || null,
      lastSeen: overrides.lastSeen || null,
      displayName: overrides.displayName || null,
      bio: overrides.bio || null,
      status: overrides.status || null,
      statusUpdatedAt: overrides.statusUpdatedAt || null,
      banned: overrides.banned ?? false,
      bannedAt: overrides.bannedAt || null,
      bannedById: overrides.bannedById || null,
      storageQuotaBytes: overrides.storageQuotaBytes ?? BigInt(0),
      storageUsedBytes: overrides.storageUsedBytes ?? BigInt(0),
      ...overrides,
    };
  }

  static buildOwner(overrides: Partial<User> = {}): User {
    return this.build({
      role: InstanceRole.OWNER,
      username: overrides.username || 'owner',
      ...overrides,
    });
  }

  static buildVerified(overrides: Partial<User> = {}): User {
    return this.build({
      verified: true,
      ...overrides,
    });
  }

  /**
   * Build a user with ALL sensitive fields populated with non-null/truthy values.
   * Use this in DTO serialization tests to verify every sensitive field is excluded.
   */
  static buildComplete(overrides: Partial<User> = {}): User {
    return this.build({
      email: 'complete@example.com',
      verified: true,
      hashedPassword: '$2b$10$completeHashedPassword',
      createdAt: new Date('2024-01-01'),
      statusUpdatedAt: new Date('2024-06-01'),
      banned: true,
      bannedAt: new Date('2024-03-01'),
      bannedById: 'admin-user-id',
      storageQuotaBytes: BigInt(53687091200),
      storageUsedBytes: BigInt(1073741824),
      avatarUrl: 'https://example.com/avatar.png',
      bannerUrl: 'https://example.com/banner.png',
      displayName: 'Complete User',
      bio: 'A complete test user',
      status: 'online',
      lastSeen: new Date('2024-06-15'),
      ...overrides,
    });
  }

  static buildMany(count: number, overrides: Partial<User> = {}): User[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  private static generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

  static resetCounter(): void {
    this.counter = 0;
  }
}
