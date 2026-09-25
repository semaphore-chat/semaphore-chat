import { InstanceInvite } from '@prisma/client';
import { randomUUID } from 'crypto';

export class InstanceInviteFactory {
  private static counter = 0;

  static build(overrides: Partial<InstanceInvite> = {}): InstanceInvite {
    const id = overrides.id || randomUUID();
    const code = overrides.code || `INVITE${this.counter++}`;

    return {
      id,
      code,
      createdById: overrides.createdById || randomUUID(),
      maxUses: overrides.maxUses || null,
      uses: overrides.uses ?? 0,
      validUntil: overrides.validUntil || null,
      createdAt: overrides.createdAt || new Date(),
      disabled: overrides.disabled ?? false,
      ...overrides,
    };
  }

  static buildUnlimited(
    overrides: Partial<InstanceInvite> = {},
  ): InstanceInvite {
    return this.build({
      maxUses: null,
      validUntil: null,
      ...overrides,
    });
  }

  static buildLimited(
    maxUses: number,
    overrides: Partial<InstanceInvite> = {},
  ): InstanceInvite {
    return this.build({
      maxUses,
      ...overrides,
    });
  }

  static buildExpired(overrides: Partial<InstanceInvite> = {}): InstanceInvite {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.build({
      validUntil: yesterday,
      ...overrides,
    });
  }

  static buildDisabled(
    overrides: Partial<InstanceInvite> = {},
  ): InstanceInvite {
    return this.build({
      disabled: true,
      ...overrides,
    });
  }

  static buildMany(
    count: number,
    overrides: Partial<InstanceInvite> = {},
  ): InstanceInvite[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  static resetCounter(): void {
    this.counter = 0;
  }
}
