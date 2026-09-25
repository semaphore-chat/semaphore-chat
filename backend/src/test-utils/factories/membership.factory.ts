import { Membership } from '@prisma/client';

export class MembershipFactory {
  static build(overrides: Partial<Membership> = {}): Membership {
    const id = overrides.id || this.generateId();

    return {
      id,
      userId: overrides.userId || this.generateId(),
      communityId: overrides.communityId || this.generateId(),
      joinedAt: overrides.joinedAt || new Date(),
      ...overrides,
    };
  }

  static buildMany(
    count: number,
    overrides: Partial<Membership> = {},
  ): Membership[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  private static generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}
