import { AliasGroup, AliasGroupMember } from '@prisma/client';

export class AliasGroupFactory {
  static build(overrides: Partial<AliasGroup> = {}): AliasGroup {
    const id = overrides.id || this.generateId();

    return {
      id,
      name: overrides.name || `group-${id.substring(0, 6)}`,
      communityId: overrides.communityId || this.generateId(),
      createdAt: overrides.createdAt || new Date(),
      ...overrides,
    };
  }

  static buildMany(
    count: number,
    overrides: Partial<AliasGroup> = {},
  ): AliasGroup[] {
    return Array.from({ length: count }, (_, i) =>
      this.build({ ...overrides, name: `group-${i + 1}` }),
    );
  }

  private static generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}

export class AliasGroupMemberFactory {
  static build(overrides: Partial<AliasGroupMember> = {}): AliasGroupMember {
    const id = overrides.id || this.generateId();

    return {
      id,
      aliasGroupId: overrides.aliasGroupId || this.generateId(),
      userId: overrides.userId || this.generateId(),
      ...overrides,
    };
  }

  static buildMany(
    count: number,
    overrides: Partial<AliasGroupMember> = {},
  ): AliasGroupMember[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  private static generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}
