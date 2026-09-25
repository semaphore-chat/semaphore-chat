import { ChannelNotificationOverride } from '@prisma/client';

export class ChannelNotificationOverrideFactory {
  static build(
    overrides: Partial<ChannelNotificationOverride> = {},
  ): ChannelNotificationOverride {
    const id = overrides.id || this.generateId();

    return {
      id,
      userId: overrides.userId || this.generateId(),
      channelId: overrides.channelId || this.generateId(),
      level: overrides.level || 'mentions',
      createdAt: overrides.createdAt || new Date(),
      updatedAt: overrides.updatedAt || new Date(),
      ...overrides,
    };
  }

  static buildAllMessages(
    overrides: Partial<ChannelNotificationOverride> = {},
  ): ChannelNotificationOverride {
    return this.build({
      level: 'all',
      ...overrides,
    });
  }

  static buildMentionsOnly(
    overrides: Partial<ChannelNotificationOverride> = {},
  ): ChannelNotificationOverride {
    return this.build({
      level: 'mentions',
      ...overrides,
    });
  }

  static buildMuted(
    overrides: Partial<ChannelNotificationOverride> = {},
  ): ChannelNotificationOverride {
    return this.build({
      level: 'none',
      ...overrides,
    });
  }

  static buildMany(
    count: number,
    overrides: Partial<ChannelNotificationOverride> = {},
  ): ChannelNotificationOverride[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  private static generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}
