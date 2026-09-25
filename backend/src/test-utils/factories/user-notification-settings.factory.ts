import { UserNotificationSettings } from '@prisma/client';

export class UserNotificationSettingsFactory {
  static build(
    overrides: Partial<UserNotificationSettings> = {},
  ): UserNotificationSettings {
    const id = overrides.id || this.generateId();

    return {
      id,
      userId: overrides.userId || this.generateId(),
      desktopEnabled: overrides.desktopEnabled ?? true,
      playSound: overrides.playSound ?? true,
      soundType: overrides.soundType || 'default',
      doNotDisturb: overrides.doNotDisturb ?? false,
      dndStartTime: overrides.dndStartTime ?? null,
      dndEndTime: overrides.dndEndTime ?? null,
      dndTimezone: overrides.dndTimezone ?? null,
      defaultChannelLevel: overrides.defaultChannelLevel || 'mentions',
      dmNotifications: overrides.dmNotifications ?? true,
      createdAt: overrides.createdAt || new Date(),
      updatedAt: overrides.updatedAt || new Date(),
      ...overrides,
    };
  }

  static buildWithDND(
    overrides: Partial<UserNotificationSettings> = {},
  ): UserNotificationSettings {
    return this.build({
      doNotDisturb: true,
      dndStartTime: '22:00',
      dndEndTime: '08:00',
      ...overrides,
    });
  }

  static buildMutedDesktop(
    overrides: Partial<UserNotificationSettings> = {},
  ): UserNotificationSettings {
    return this.build({
      desktopEnabled: false,
      ...overrides,
    });
  }

  static buildMutedDMs(
    overrides: Partial<UserNotificationSettings> = {},
  ): UserNotificationSettings {
    return this.build({
      dmNotifications: false,
      ...overrides,
    });
  }

  static buildAllChannelsMode(
    overrides: Partial<UserNotificationSettings> = {},
  ): UserNotificationSettings {
    return this.build({
      defaultChannelLevel: 'all',
      ...overrides,
    });
  }

  static buildMentionsOnlyMode(
    overrides: Partial<UserNotificationSettings> = {},
  ): UserNotificationSettings {
    return this.build({
      defaultChannelLevel: 'mentions',
      ...overrides,
    });
  }

  static buildSilentMode(
    overrides: Partial<UserNotificationSettings> = {},
  ): UserNotificationSettings {
    return this.build({
      defaultChannelLevel: 'none',
      ...overrides,
    });
  }

  private static generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}
