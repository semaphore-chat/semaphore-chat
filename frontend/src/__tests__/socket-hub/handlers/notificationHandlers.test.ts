import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type {
  NotificationListResponseDto,
  UnreadCountResponseDto,
  UnreadCountDto,
  NotificationDto,
} from '../../../api-client';
import {
  notificationsControllerGetNotificationsQueryKey,
  notificationsControllerGetUnreadCountQueryKey,
  readReceiptsControllerGetUnreadCountsQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';
import {
  handleNewNotification,
  handleNotificationRead,
} from '../../../socket-hub/handlers/notificationHandlers';
import { NotificationType } from '../../../types/notification.type';
import type { NewNotificationPayload } from '@semaphore-chat/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type NotificationSpan = NonNullable<NewNotificationPayload['message']>['spans'][number];

function makeNotificationPayload(
  overrides: Partial<NewNotificationPayload> = {},
): NewNotificationPayload {
  return {
    notificationId: 'notif-1',
    type: NotificationType.USER_MENTION,
    messageId: 'msg-1',
    channelId: 'ch-1',
    communityId: 'comm-1',
    channelName: 'general',
    directMessageGroupId: null,
    authorId: 'user-2',
    author: { id: 'user-2', username: 'alice', displayName: null, avatarUrl: null },
    message: {
      id: 'msg-1',
      channelId: 'ch-1',
      directMessageGroupId: null,
      spans: [{ type: 'PLAINTEXT', text: 'hello' } as NotificationSpan],
    },
    createdAt: '2024-06-01T00:00:00Z',
    read: false,
    ...overrides,
  };
}

function makeNotificationDto(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: 'notif-1',
    userId: '',
    type: 'USER_MENTION',
    messageId: 'msg-1',
    channelId: 'ch-1',
    communityId: 'comm-1',
    directMessageGroupId: null,
    authorId: 'user-2',
    parentMessageId: null,
    read: false,
    dismissed: false,
    createdAt: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

function makeNotificationList(
  notifications: NotificationDto[] = [],
  overrides: Partial<NotificationListResponseDto> = {},
): NotificationListResponseDto {
  return {
    notifications,
    total: notifications.length,
    unreadCount: notifications.filter((n) => !n.read).length,
    ...overrides,
  };
}

function makeUnreadCounts(entries: UnreadCountDto[]): UnreadCountDto[] {
  return entries;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('notificationHandlers', () => {
  let queryClient: QueryClient;
  let notificationsKey: ReturnType<typeof notificationsControllerGetNotificationsQueryKey>;
  let unreadCountKey: ReturnType<typeof notificationsControllerGetUnreadCountQueryKey>;
  let readReceiptsKey: ReturnType<typeof readReceiptsControllerGetUnreadCountsQueryKey>;

  beforeEach(() => {
    queryClient = new QueryClient();
    notificationsKey = notificationsControllerGetNotificationsQueryKey();
    unreadCountKey = notificationsControllerGetUnreadCountQueryKey();
    readReceiptsKey = readReceiptsControllerGetUnreadCountsQueryKey();
  });

  // =========================================================================
  // handleNewNotification
  // =========================================================================

  describe('handleNewNotification', () => {
    it('prepends a new notification to the cache and increments total', () => {
      const existing = makeNotificationDto({ id: 'notif-0', read: true });
      queryClient.setQueryData(notificationsKey, makeNotificationList([existing], { total: 1, unreadCount: 0 }));

      const payload = makeNotificationPayload({ notificationId: 'notif-1', read: false });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<NotificationListResponseDto>(notificationsKey);
      expect(data).toBeDefined();
      expect(data!.notifications).toHaveLength(2);
      expect(data!.notifications[0].id).toBe('notif-1');
      expect(data!.notifications[1].id).toBe('notif-0');
      expect(data!.total).toBe(2);
    });

    it('does not create duplicates when the same notification ID is received twice', () => {
      const existing = makeNotificationDto({ id: 'notif-1' });
      queryClient.setQueryData(notificationsKey, makeNotificationList([existing]));

      const payload = makeNotificationPayload({ notificationId: 'notif-1' });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<NotificationListResponseDto>(notificationsKey);
      expect(data!.notifications).toHaveLength(1);
    });

    it('caps the cache at 100 notifications', () => {
      const hundredNotifications = Array.from({ length: 100 }, (_, i) =>
        makeNotificationDto({ id: `notif-${i}`, read: true }),
      );
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList(hundredNotifications, { total: 100, unreadCount: 0 }),
      );

      const payload = makeNotificationPayload({ notificationId: 'notif-new', read: false });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<NotificationListResponseDto>(notificationsKey);
      expect(data!.notifications).toHaveLength(100);
      expect(data!.notifications[0].id).toBe('notif-new');
      expect(data!.notifications[99].id).toBe('notif-98');
      expect(data!.total).toBe(101);
    });

    it('increments unreadCount in the list when notification is unread', () => {
      queryClient.setQueryData(notificationsKey, makeNotificationList([], { total: 0, unreadCount: 0 }));

      const payload = makeNotificationPayload({ notificationId: 'notif-1', read: false });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<NotificationListResponseDto>(notificationsKey);
      expect(data!.unreadCount).toBe(1);
    });

    it('does NOT increment unreadCount in the list when notification is already read', () => {
      queryClient.setQueryData(notificationsKey, makeNotificationList([], { total: 0, unreadCount: 0 }));

      const payload = makeNotificationPayload({ notificationId: 'notif-1', read: true });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<NotificationListResponseDto>(notificationsKey);
      expect(data!.unreadCount).toBe(0);
    });

    it('increments the badge unread count when notification is unread', () => {
      queryClient.setQueryData(unreadCountKey, { count: 3 } satisfies UnreadCountResponseDto);

      const payload = makeNotificationPayload({ notificationId: 'notif-1', read: false });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<UnreadCountResponseDto>(unreadCountKey);
      expect(data!.count).toBe(4);
    });

    it('does NOT increment the badge unread count when notification is already read', () => {
      queryClient.setQueryData(unreadCountKey, { count: 3 } satisfies UnreadCountResponseDto);

      const payload = makeNotificationPayload({ notificationId: 'notif-1', read: true });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<UnreadCountResponseDto>(unreadCountKey);
      expect(data!.count).toBe(3);
    });

    it('initializes badge unread count to 1 when no prior cache exists', () => {
      const payload = makeNotificationPayload({ notificationId: 'notif-1', read: false });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<UnreadCountResponseDto>(unreadCountKey);
      expect(data).toEqual({ count: 1 });
    });

    it('increments mentionCount for USER_MENTION type', () => {
      queryClient.setQueryData(notificationsKey, makeNotificationList([]));
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([{ channelId: 'ch-1', unreadCount: 2, mentionCount: 0 }]),
      );

      const payload = makeNotificationPayload({
        notificationId: 'notif-1',
        type: NotificationType.USER_MENTION,
        channelId: 'ch-1',
        read: false,
      });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      expect(data![0].mentionCount).toBe(1);
    });

    it('increments mentionCount for SPECIAL_MENTION type', () => {
      queryClient.setQueryData(notificationsKey, makeNotificationList([]));
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([{ channelId: 'ch-1', unreadCount: 0, mentionCount: 2 }]),
      );

      const payload = makeNotificationPayload({
        notificationId: 'notif-2',
        type: NotificationType.SPECIAL_MENTION,
        channelId: 'ch-1',
        read: false,
      });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      expect(data![0].mentionCount).toBe(3);
    });

    it('increments mentionCount for DIRECT_MESSAGE type', () => {
      queryClient.setQueryData(notificationsKey, makeNotificationList([]));
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([
          { directMessageGroupId: 'dm-1', unreadCount: 1, mentionCount: 0 },
        ]),
      );

      const payload = makeNotificationPayload({
        notificationId: 'notif-3',
        type: NotificationType.DIRECT_MESSAGE,
        channelId: null,
        directMessageGroupId: 'dm-1',
        read: false,
      });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      expect(data![0].mentionCount).toBe(1);
    });

    it('does NOT increment mentionCount for CHANNEL_MESSAGE type', () => {
      queryClient.setQueryData(notificationsKey, makeNotificationList([]));
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([{ channelId: 'ch-1', unreadCount: 5, mentionCount: 0 }]),
      );

      const payload = makeNotificationPayload({
        notificationId: 'notif-4',
        type: NotificationType.CHANNEL_MESSAGE,
        channelId: 'ch-1',
        read: false,
      });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      expect(data![0].mentionCount).toBe(0);
    });

    it('creates a new read-receipts entry when the channel is not yet tracked', () => {
      queryClient.setQueryData(notificationsKey, makeNotificationList([]));
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([{ channelId: 'ch-other', unreadCount: 1, mentionCount: 0 }]),
      );

      const payload = makeNotificationPayload({
        notificationId: 'notif-5',
        type: NotificationType.USER_MENTION,
        channelId: 'ch-new',
        read: false,
      });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      expect(data).toHaveLength(2);
      const newEntry = data!.find((c) => c.channelId === 'ch-new');
      expect(newEntry).toBeDefined();
      expect(newEntry!.mentionCount).toBe(1);
      expect(newEntry!.unreadCount).toBe(0);
    });

    it('returns old data unchanged when notifications cache is undefined', () => {
      // Do not seed the notifications cache at all
      const payload = makeNotificationPayload({ notificationId: 'notif-1' });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<NotificationListResponseDto>(notificationsKey);
      expect(data).toBeUndefined();
    });

    it('handles notification in a DM context using directMessageGroupId', () => {
      queryClient.setQueryData(notificationsKey, makeNotificationList([]));
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([
          { directMessageGroupId: 'dm-group-1', unreadCount: 3, mentionCount: 1 },
        ]),
      );

      const payload = makeNotificationPayload({
        notificationId: 'notif-dm',
        type: NotificationType.DIRECT_MESSAGE,
        channelId: null,
        directMessageGroupId: 'dm-group-1',
        read: false,
      });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      const dmEntry = data!.find((c) => c.directMessageGroupId === 'dm-group-1');
      expect(dmEntry).toBeDefined();
      expect(dmEntry!.mentionCount).toBe(2);
    });

    it('does not touch read-receipts cache when it is undefined', () => {
      queryClient.setQueryData(notificationsKey, makeNotificationList([]));
      // Do not seed readReceiptsKey

      const payload = makeNotificationPayload({
        notificationId: 'notif-1',
        type: NotificationType.USER_MENTION,
        channelId: 'ch-1',
        read: false,
      });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      expect(data).toBeUndefined();
    });

    it('maps author and message fields from payload into the notification DTO', () => {
      queryClient.setQueryData(notificationsKey, makeNotificationList([]));

      const payload = makeNotificationPayload({
        notificationId: 'notif-rich',
        author: { id: 'u-5', username: 'bob', displayName: null, avatarUrl: 'https://img.test/avatar.png' },
        message: {
          id: 'msg-10',
          channelId: 'ch-1',
          directMessageGroupId: null,
          spans: [
            { type: 'MENTION', text: '@alice', userId: 'u-1' } as unknown as NotificationSpan,
            { type: 'PLAINTEXT', text: ' hey' } as NotificationSpan,
          ],
        },
      });
      handleNewNotification(payload, queryClient);

      const data = queryClient.getQueryData<NotificationListResponseDto>(notificationsKey);
      const notif = data!.notifications[0];
      expect(notif.author).toEqual({
        id: 'u-5',
        username: 'bob',
        displayName: null,
        avatarUrl: 'https://img.test/avatar.png',
      });
      expect(notif.message).toEqual({
        id: 'msg-10',
        channelId: 'ch-1',
        directMessageGroupId: null,
        spans: [
          { type: 'MENTION', text: '@alice', userId: 'u-1', specialKind: null, communityId: null, aliasId: null },
          { type: 'PLAINTEXT', text: ' hey', userId: null, specialKind: null, communityId: null, aliasId: null },
        ],
      });
    });
  });

  // =========================================================================
  // handleNotificationRead
  // =========================================================================

  describe('handleNotificationRead', () => {
    it('marks a notification as read in the cache and decrements unreadCount', () => {
      const notif = makeNotificationDto({ id: 'notif-1', read: false, type: 'CHANNEL_MESSAGE' });
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList([notif], { total: 1, unreadCount: 1 }),
      );
      queryClient.setQueryData(unreadCountKey, { count: 1 } satisfies UnreadCountResponseDto);

      handleNotificationRead({ notificationId: 'notif-1' }, queryClient);

      const listData = queryClient.getQueryData<NotificationListResponseDto>(notificationsKey);
      expect(listData!.notifications[0].read).toBe(true);
      expect(listData!.unreadCount).toBe(0);

      const countData = queryClient.getQueryData<UnreadCountResponseDto>(unreadCountKey);
      expect(countData!.count).toBe(0);
    });

    it('is idempotent - reading an already-read notification does not change the cache', () => {
      const notif = makeNotificationDto({ id: 'notif-1', read: true, type: 'CHANNEL_MESSAGE' });
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList([notif], { total: 1, unreadCount: 0 }),
      );
      queryClient.setQueryData(unreadCountKey, { count: 0 } satisfies UnreadCountResponseDto);

      handleNotificationRead({ notificationId: 'notif-1' }, queryClient);

      const listData = queryClient.getQueryData<NotificationListResponseDto>(notificationsKey);
      expect(listData!.unreadCount).toBe(0);

      // Badge count should not go below 0
      const countData = queryClient.getQueryData<UnreadCountResponseDto>(unreadCountKey);
      expect(countData!.count).toBe(0);
    });

    it('clamps unread count to 0 and never goes negative', () => {
      const notif = makeNotificationDto({ id: 'notif-1', read: false, type: 'CHANNEL_MESSAGE' });
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList([notif], { total: 1, unreadCount: 0 }),
      );
      queryClient.setQueryData(unreadCountKey, { count: 0 } satisfies UnreadCountResponseDto);

      handleNotificationRead({ notificationId: 'notif-1' }, queryClient);

      const listData = queryClient.getQueryData<NotificationListResponseDto>(notificationsKey);
      expect(listData!.unreadCount).toBe(0);

      const countData = queryClient.getQueryData<UnreadCountResponseDto>(unreadCountKey);
      expect(countData!.count).toBe(0);
    });

    it('decrements mentionCount for USER_MENTION type', () => {
      const notif = makeNotificationDto({
        id: 'notif-1',
        read: false,
        type: 'USER_MENTION',
        channelId: 'ch-1',
      });
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList([notif], { total: 1, unreadCount: 1 }),
      );
      queryClient.setQueryData(unreadCountKey, { count: 1 } satisfies UnreadCountResponseDto);
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([{ channelId: 'ch-1', unreadCount: 5, mentionCount: 2 }]),
      );

      handleNotificationRead({ notificationId: 'notif-1' }, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      expect(data![0].mentionCount).toBe(1);
    });

    it('decrements mentionCount for SPECIAL_MENTION type', () => {
      const notif = makeNotificationDto({
        id: 'notif-1',
        read: false,
        type: 'SPECIAL_MENTION',
        channelId: 'ch-1',
      });
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList([notif], { total: 1, unreadCount: 1 }),
      );
      queryClient.setQueryData(unreadCountKey, { count: 1 } satisfies UnreadCountResponseDto);
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([{ channelId: 'ch-1', unreadCount: 3, mentionCount: 1 }]),
      );

      handleNotificationRead({ notificationId: 'notif-1' }, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      expect(data![0].mentionCount).toBe(0);
    });

    it('decrements mentionCount for DIRECT_MESSAGE type', () => {
      const notif = makeNotificationDto({
        id: 'notif-dm',
        read: false,
        type: 'DIRECT_MESSAGE',
        channelId: null,
        directMessageGroupId: 'dm-1',
      });
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList([notif], { total: 1, unreadCount: 1 }),
      );
      queryClient.setQueryData(unreadCountKey, { count: 1 } satisfies UnreadCountResponseDto);
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([{ directMessageGroupId: 'dm-1', unreadCount: 2, mentionCount: 3 }]),
      );

      handleNotificationRead({ notificationId: 'notif-dm' }, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      const dmEntry = data!.find((c) => c.directMessageGroupId === 'dm-1');
      expect(dmEntry!.mentionCount).toBe(2);
    });

    it('does NOT decrement mentionCount for CHANNEL_MESSAGE type', () => {
      const notif = makeNotificationDto({
        id: 'notif-ch',
        read: false,
        type: 'CHANNEL_MESSAGE',
        channelId: 'ch-1',
      });
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList([notif], { total: 1, unreadCount: 1 }),
      );
      queryClient.setQueryData(unreadCountKey, { count: 1 } satisfies UnreadCountResponseDto);
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([{ channelId: 'ch-1', unreadCount: 5, mentionCount: 3 }]),
      );

      handleNotificationRead({ notificationId: 'notif-ch' }, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      expect(data![0].mentionCount).toBe(3);
    });

    it('clamps mentionCount to 0 and never goes negative', () => {
      const notif = makeNotificationDto({
        id: 'notif-1',
        read: false,
        type: 'USER_MENTION',
        channelId: 'ch-1',
      });
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList([notif], { total: 1, unreadCount: 1 }),
      );
      queryClient.setQueryData(unreadCountKey, { count: 1 } satisfies UnreadCountResponseDto);
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([{ channelId: 'ch-1', unreadCount: 0, mentionCount: 0 }]),
      );

      handleNotificationRead({ notificationId: 'notif-1' }, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      expect(data![0].mentionCount).toBe(0);
    });

    it('handles reading a notification that does not exist in the cache gracefully', () => {
      const notif = makeNotificationDto({ id: 'notif-1', read: false });
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList([notif], { total: 1, unreadCount: 1 }),
      );
      queryClient.setQueryData(unreadCountKey, { count: 1 } satisfies UnreadCountResponseDto);

      // Read a notification ID that is NOT in the cache
      handleNotificationRead({ notificationId: 'notif-nonexistent' }, queryClient);

      // The list should remain unchanged
      const listData = queryClient.getQueryData<NotificationListResponseDto>(notificationsKey);
      expect(listData!.notifications[0].read).toBe(false);
      expect(listData!.unreadCount).toBe(1);

      // Badge count still decrements because the badge update runs unconditionally
      const countData = queryClient.getQueryData<UnreadCountResponseDto>(unreadCountKey);
      expect(countData!.count).toBe(0);
    });

    it('returns undefined unchanged when unread count cache does not exist', () => {
      // Do not seed unreadCountKey
      const notif = makeNotificationDto({ id: 'notif-1', read: false, type: 'CHANNEL_MESSAGE' });
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList([notif], { total: 1, unreadCount: 1 }),
      );

      handleNotificationRead({ notificationId: 'notif-1' }, queryClient);

      const data = queryClient.getQueryData<UnreadCountResponseDto>(unreadCountKey);
      expect(data).toBeUndefined();
    });

    it('does not touch read-receipts when the notification has no contextId', () => {
      const notif = makeNotificationDto({
        id: 'notif-no-ctx',
        read: false,
        type: 'USER_MENTION',
        channelId: null,
        directMessageGroupId: null,
      });
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList([notif], { total: 1, unreadCount: 1 }),
      );
      queryClient.setQueryData(unreadCountKey, { count: 1 } satisfies UnreadCountResponseDto);
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([{ channelId: 'ch-1', unreadCount: 0, mentionCount: 5 }]),
      );

      handleNotificationRead({ notificationId: 'notif-no-ctx' }, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      expect(data![0].mentionCount).toBe(5);
    });

    it('does not touch read-receipts when the contextId is not found in the cache', () => {
      const notif = makeNotificationDto({
        id: 'notif-1',
        read: false,
        type: 'USER_MENTION',
        channelId: 'ch-unknown',
      });
      queryClient.setQueryData(
        notificationsKey,
        makeNotificationList([notif], { total: 1, unreadCount: 1 }),
      );
      queryClient.setQueryData(unreadCountKey, { count: 1 } satisfies UnreadCountResponseDto);
      queryClient.setQueryData(
        readReceiptsKey,
        makeUnreadCounts([{ channelId: 'ch-other', unreadCount: 0, mentionCount: 2 }]),
      );

      handleNotificationRead({ notificationId: 'notif-1' }, queryClient);

      const data = queryClient.getQueryData<UnreadCountDto[]>(readReceiptsKey);
      expect(data).toHaveLength(1);
      expect(data![0].mentionCount).toBe(2);
    });
  });
});
