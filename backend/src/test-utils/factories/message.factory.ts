import { randomUUID } from 'crypto';
import { Message } from '@prisma/client';

export class MessageFactory {
  private static counter = 0;

  static build(overrides: Partial<Message> = {}): Message {
    const id = overrides.id || randomUUID();

    return {
      id,
      channelId: overrides.channelId || randomUUID(),
      directMessageGroupId: overrides.directMessageGroupId || null,
      authorId: overrides.authorId || randomUUID(),
      sentAt: overrides.sentAt || new Date(),
      editedAt: overrides.editedAt || null,
      deletedAt: overrides.deletedAt || null,
      pendingAttachments: overrides.pendingAttachments ?? 0,
      searchText: overrides.searchText || `Test message ${this.counter++}`,
      pinned: overrides.pinned ?? false,
      pinnedAt: overrides.pinnedAt || null,
      pinnedBy: overrides.pinnedBy || null,
      deletedBy: overrides.deletedBy || null,
      deletedByReason: overrides.deletedByReason || null,
      parentMessageId: overrides.parentMessageId || null,
      replyCount: overrides.replyCount ?? 0,
      lastReplyAt: overrides.lastReplyAt || null,
      replyToId: null,
      linkPreviews: null,
      webhookId: null,
      // What the standard includes load (see messages/message.mapper.ts)
      spans: [],
      reactions: [],
      attachments: [],
      webhook: null,
      ...overrides,
    } as Message;
  }

  static buildDeleted(overrides: Partial<Message> = {}): Message {
    return this.build({
      deletedAt: new Date(),
      ...overrides,
    });
  }

  static buildEdited(overrides: Partial<Message> = {}): Message {
    return this.build({
      editedAt: new Date(),
      ...overrides,
    });
  }

  static buildDirectMessage(overrides: Partial<Message> = {}): Message {
    return this.build({
      channelId: null,
      directMessageGroupId: randomUUID(),
      ...overrides,
    });
  }

  static buildMany(count: number, overrides: Partial<Message> = {}): Message[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  static resetCounter(): void {
    this.counter = 0;
  }
}
