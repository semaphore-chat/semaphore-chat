import { ChannelMembership } from '@prisma/client';

export class ChannelMembershipFactory {
  static build(overrides: Partial<ChannelMembership> = {}): ChannelMembership {
    const id = overrides.id || this.generateId();

    return {
      id,
      userId: overrides.userId || this.generateId(),
      channelId: overrides.channelId || this.generateId(),
      joinedAt: overrides.joinedAt || new Date(),
      addedBy: overrides.addedBy || null,
      ...overrides,
    };
  }

  static buildWithAddedBy(
    addedById: string,
    overrides: Partial<ChannelMembership> = {},
  ): ChannelMembership {
    return this.build({
      addedBy: addedById,
      ...overrides,
    });
  }

  static buildMany(
    count: number,
    overrides: Partial<ChannelMembership> = {},
  ): ChannelMembership[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  private static generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}
