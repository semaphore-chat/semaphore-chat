import { RefreshToken } from '@prisma/client';

export class RefreshTokenFactory {
  static build(overrides: Partial<RefreshToken> = {}): RefreshToken {
    const id = overrides.id || this.generateId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

    return {
      id,
      userId: overrides.userId || this.generateId(),
      tokenHash: overrides.tokenHash || this.generateTokenHash(),
      createdAt: overrides.createdAt || now,
      expiresAt: overrides.expiresAt || expiresAt,
      deviceName: null,
      userAgent: null,
      ipAddress: null,
      lastUsedAt: now,
      familyId: this.generateId(),
      consumed: false,
      consumedAt: null,
      ...overrides,
    } as RefreshToken;
  }

  static buildExpired(overrides: Partial<RefreshToken> = {}): RefreshToken {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.build({
      expiresAt: yesterday,
      ...overrides,
    });
  }

  static buildMany(
    count: number,
    overrides: Partial<RefreshToken> = {},
  ): RefreshToken[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  private static generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

  private static generateTokenHash(): string {
    return Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  }
}
