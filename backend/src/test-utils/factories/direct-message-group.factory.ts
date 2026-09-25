import { DirectMessageGroup } from '@prisma/client';

export class DirectMessageGroupFactory {
  static build(
    overrides: Partial<DirectMessageGroup> = {},
  ): DirectMessageGroup {
    const id = overrides.id || this.generateId();

    return {
      id,
      name: overrides.name || null,
      createdAt: overrides.createdAt || new Date(),
      isGroup: overrides.isGroup ?? false,
      ...overrides,
    };
  }

  static buildDirectMessage(
    overrides: Partial<DirectMessageGroup> = {},
  ): DirectMessageGroup {
    return this.build({
      name: null,
      isGroup: false,
      ...overrides,
    });
  }

  static buildGroupChat(
    name: string,
    overrides: Partial<DirectMessageGroup> = {},
  ): DirectMessageGroup {
    return this.build({
      name,
      isGroup: true,
      ...overrides,
    });
  }

  static buildMany(
    count: number,
    overrides: Partial<DirectMessageGroup> = {},
  ): DirectMessageGroup[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  private static generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}
