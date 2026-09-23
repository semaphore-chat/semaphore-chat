import { describe, it, expect } from 'vitest';
import {
  getTimeAgo,
  getNotificationTypeLabel,
  getNotificationText,
  getMessagePreview,
  getNotificationAuthorName,
} from '../../utils/notificationHelpers';
import { NotificationType } from '../../types/notification.type';
import type { Notification } from '../../types/notification.type';

function createNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    userId: 'user-1',
    type: NotificationType.CHANNEL_MESSAGE,
    messageId: null,
    channelId: null,
    directMessageGroupId: null,
    authorId: 'author-1',
    read: false,
    dismissed: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('getTimeAgo', () => {
  it('returns a string containing "ago" for a valid date', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(getTimeAgo(fiveMinutesAgo)).toContain('ago');
  });

  it('returns "Recently" for an invalid date string', () => {
    expect(getTimeAgo('not-a-date')).toBe('Recently');
  });
});

describe('getNotificationTypeLabel', () => {
  it('returns "Mentioned you" for USER_MENTION', () => {
    expect(getNotificationTypeLabel(NotificationType.USER_MENTION)).toBe('Mentioned you');
  });

  it('returns "Mentioned everyone" for SPECIAL_MENTION', () => {
    expect(getNotificationTypeLabel(NotificationType.SPECIAL_MENTION)).toBe('Mentioned everyone');
  });

  it('returns "Replied in a thread" for THREAD_REPLY', () => {
    expect(getNotificationTypeLabel(NotificationType.THREAD_REPLY)).toBe('Replied in a thread');
  });

  it('has a real label (not the generic fallback) for every notification type', () => {
    for (const type of Object.values(NotificationType)) {
      expect(getNotificationTypeLabel(type)).not.toBe('Notification');
    }
  });

  it('returns "Sent a message" for DIRECT_MESSAGE', () => {
    expect(getNotificationTypeLabel(NotificationType.DIRECT_MESSAGE)).toBe('Sent a message');
  });

  it('returns "New message" for CHANNEL_MESSAGE', () => {
    expect(getNotificationTypeLabel(NotificationType.CHANNEL_MESSAGE)).toBe('New message');
  });

  it('returns "Notification" for an unknown type', () => {
    expect(getNotificationTypeLabel('UNKNOWN' as NotificationType)).toBe('Notification');
  });
});

describe('getNotificationText', () => {
  it('returns "author mentioned you: preview" for USER_MENTION', () => {
    const notification = createNotification({
      type: NotificationType.USER_MENTION,
      author: { id: 'a1', username: 'alice' },
      message: { id: 'm1', spans: [{ type: 'PLAINTEXT', text: 'hey there' }] },
    });
    expect(getNotificationText(notification)).toBe('alice mentioned you: hey there');
  });

  it('returns "author mentioned everyone: preview" for SPECIAL_MENTION', () => {
    const notification = createNotification({
      type: NotificationType.SPECIAL_MENTION,
      author: { id: 'a1', username: 'bob' },
      message: { id: 'm1', spans: [{ type: 'PLAINTEXT', text: 'check this out' }] },
    });
    expect(getNotificationText(notification)).toBe('bob mentioned everyone: check this out');
  });

  it('returns "author: preview" for DIRECT_MESSAGE', () => {
    const notification = createNotification({
      type: NotificationType.DIRECT_MESSAGE,
      author: { id: 'a1', username: 'carol' },
      message: { id: 'm1', spans: [{ type: 'PLAINTEXT', text: 'hello' }] },
    });
    expect(getNotificationText(notification)).toBe('carol: hello');
  });

  it('returns "author: preview" for CHANNEL_MESSAGE', () => {
    const notification = createNotification({
      type: NotificationType.CHANNEL_MESSAGE,
      author: { id: 'a1', username: 'dave' },
      message: { id: 'm1', spans: [{ type: 'PLAINTEXT', text: 'update' }] },
    });
    expect(getNotificationText(notification)).toBe('dave: update');
  });

  it('uses "Someone" when author is missing', () => {
    const notification = createNotification({
      type: NotificationType.DIRECT_MESSAGE,
      message: { id: 'm1', spans: [{ type: 'PLAINTEXT', text: 'hi' }] },
    });
    expect(getNotificationText(notification)).toBe('Someone: hi');
  });

  it('uses "New message" fallback for DM when message has no spans', () => {
    const notification = createNotification({
      type: NotificationType.DIRECT_MESSAGE,
      author: { id: 'a1', username: 'eve' },
      message: { id: 'm1', spans: [] },
    });
    expect(getNotificationText(notification)).toBe('eve: New message');
  });

  it('uses "New message" fallback for channel message when there is no message at all', () => {
    const notification = createNotification({
      type: NotificationType.CHANNEL_MESSAGE,
      author: { id: 'a1', username: 'frank' },
    });
    expect(getNotificationText(notification)).toBe('frank: New message');
  });

  it('omits trailing colon for mention with no message preview', () => {
    const notification = createNotification({
      type: NotificationType.USER_MENTION,
      author: { id: 'a1', username: 'grace' },
      message: { id: 'm1', spans: [] },
    });
    expect(getNotificationText(notification)).toBe('grace mentioned you');
  });

  it('omits trailing colon for special mention with no message preview', () => {
    const notification = createNotification({
      type: NotificationType.SPECIAL_MENTION,
      author: { id: 'a1', username: 'heidi' },
    });
    expect(getNotificationText(notification)).toBe('heidi mentioned everyone');
  });
});

describe('getNotificationAuthorName', () => {
  it('prefers the display name', () => {
    const notification = createNotification({
      author: { id: 'a1', username: 'priya_d', displayName: 'Priya Diallo' },
    });
    expect(getNotificationAuthorName(notification)).toBe('Priya Diallo');
  });

  it('falls back to the username when there is no display name', () => {
    const notification = createNotification({
      author: { id: 'a1', username: 'priya_d', displayName: null },
    });
    expect(getNotificationAuthorName(notification)).toBe('priya_d');
  });

  it('falls back to "Someone" when there is no author', () => {
    expect(getNotificationAuthorName(createNotification())).toBe('Someone');
  });
});

describe('getNotificationText (display names and thread replies)', () => {
  it('uses the display name rather than the username', () => {
    const notification = createNotification({
      type: NotificationType.DIRECT_MESSAGE,
      author: { id: 'a1', username: 'priya_d', displayName: 'Priya Diallo' },
      message: { id: 'm1', spans: [{ type: 'PLAINTEXT', text: 'hi' }] },
    });
    expect(getNotificationText(notification)).toBe('Priya Diallo: hi');
  });

  it('describes thread replies', () => {
    const notification = createNotification({
      type: NotificationType.THREAD_REPLY,
      author: { id: 'a1', username: 'ivan' },
      message: { id: 'm1', spans: [{ type: 'PLAINTEXT', text: 'agreed' }] },
    });
    expect(getNotificationText(notification)).toBe('ivan replied in a thread: agreed');
  });
});

describe('getMessagePreview', () => {
  it('extracts PLAINTEXT span text', () => {
    const notification = createNotification({
      message: {
        id: 'm1',
        spans: [
          { type: 'PLAINTEXT', text: 'Hello ' },
          { type: 'MENTION', text: undefined, userId: 'u1' },
          { type: 'PLAINTEXT', text: 'world' },
        ],
      },
    });
    expect(getMessagePreview(notification)).toBe('Hello world');
  });

  it('truncates text longer than 100 characters', () => {
    const longText = 'a'.repeat(150);
    const notification = createNotification({
      message: { id: 'm1', spans: [{ type: 'PLAINTEXT', text: longText }] },
    });
    const result = getMessagePreview(notification);
    expect(result).toBe('a'.repeat(100) + '...');
    expect(result.length).toBe(103);
  });

  it('returns empty string for empty spans array', () => {
    const notification = createNotification({
      message: { id: 'm1', spans: [] },
    });
    expect(getMessagePreview(notification)).toBe('');
  });

  it('returns empty string when there is no message', () => {
    const notification = createNotification();
    expect(getMessagePreview(notification)).toBe('');
  });
});
