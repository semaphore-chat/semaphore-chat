import { Community } from '@prisma/client';

export class CommunityFactory {
  private static counter = 0;

  static build(overrides: Partial<Community> = {}): Community {
    const id = overrides.id || this.generateId();
    const name = overrides.name || `Community ${this.counter++}`;

    return {
      id,
      name,
      createdAt: overrides.createdAt || new Date(),
      avatar: overrides.avatar || null,
      banner: overrides.banner || null,
      description: overrides.description || null,
      ...overrides,
    };
  }

  static buildWithAvatar(overrides: Partial<Community> = {}): Community {
    return this.build({
      avatar: 'https://example.com/avatar.png',
      ...overrides,
    });
  }

  static buildWithBanner(overrides: Partial<Community> = {}): Community {
    return this.build({
      banner: 'https://example.com/banner.png',
      ...overrides,
    });
  }

  static buildMany(
    count: number,
    overrides: Partial<Community> = {},
  ): Community[] {
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
