import { ReadReceipt } from '@prisma/client';

export class ReadReceiptFactory {
  private static counter = 0;

  static build(overrides: Partial<ReadReceipt> = {}): ReadReceipt {
    const id = overrides.id || this.generateId();

    return {
      id,
      userId: overrides.userId || this.generateId(),
      channelId: overrides.channelId ?? null,
      directMessageGroupId: overrides.directMessageGroupId ?? null,
      lastReadMessageId: overrides.lastReadMessageId || this.generateId(),
      lastReadAt: overrides.lastReadAt || new Date(),
      ...overrides,
    };
  }

  static buildForChannel(overrides: Partial<ReadReceipt> = {}): ReadReceipt {
    return this.build({
      channelId: overrides.channelId || this.generateId(),
      directMessageGroupId: null,
      ...overrides,
    });
  }

  static buildForDirectMessageGroup(
    overrides: Partial<ReadReceipt> = {},
  ): ReadReceipt {
    return this.build({
      channelId: null,
      directMessageGroupId: overrides.directMessageGroupId || this.generateId(),
      ...overrides,
    });
  }

  static buildMany(
    count: number,
    overrides: Partial<ReadReceipt> = {},
  ): ReadReceipt[] {
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
