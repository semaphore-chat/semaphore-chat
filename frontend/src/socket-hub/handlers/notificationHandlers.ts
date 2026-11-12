import type { QueryClient } from '@tanstack/react-query';
import type {
  ServerEvents,
  NewNotificationPayload,
  NotificationReadPayload,
  NotificationsReadPayload,
  NotificationDismissedPayload,
} from '@semaphore-chat/shared';
import {
  notificationsControllerGetNotificationsQueryKey,
  notificationsControllerGetUnreadCountQueryKey,
  readReceiptsControllerGetUnreadCountsQueryKey,
} from '../../api-client/@tanstack/react-query.gen';
import type {
  NotificationListResponseDto,
  UnreadCountResponseDto,
  UnreadCountDto,
  NotificationDto,
  SpanDto,
} from '../../api-client';
import { NotificationType } from '../../types/notification.type';
import type { SocketEventHandler } from './types';

export const handleNewNotification: SocketEventHandler<typeof ServerEvents.NEW_NOTIFICATION> = (
  payload: NewNotificationPayload,
  queryClient: QueryClient,
) => {
  // Convert WebSocket payload to NotificationDto shape for TQ cache
  const notification: NotificationDto = {
    id: payload.notificationId,
    userId: '',
    type: payload.type,
    messageId: payload.messageId ?? null,
    channelId: payload.channelId ?? null,
    communityId: payload.communityId ?? null,
    directMessageGroupId: payload.directMessageGroupId ?? null,
    authorId: payload.authorId,
    parentMessageId: null,
    read: payload.read,
    dismissed: false,
    createdAt: payload.createdAt,
    author: payload.author
      ? {
          id: payload.author.id || '',
          username: payload.author.username,
          displayName: null,
          avatarUrl: payload.author.avatarUrl ?? null,
        }
      : undefined,
    message: payload.message
      ? {
          id: payload.message.id || '',
          channelId: payload.channelId ?? null,
          directMessageGroupId: payload.directMessageGroupId ?? null,
          spans: payload.message.spans.map((s) => ({
            // The WS payload types span.type as a plain string; the values come
            // from the same backend enum the SpanDto union is generated from.
            type: s.type as SpanDto['type'],
            text: s.text ?? null,
            userId: s.userId ?? null,
            specialKind: s.specialKind ?? null,
            communityId: null,
            aliasId: null,
          })),
        }
      : undefined,
  };

  // Prepend to all notifications query caches
  const notificationsQueryKey = notificationsControllerGetNotificationsQueryKey();
  queryClient.setQueriesData<NotificationListResponseDto>(
    { queryKey: notificationsQueryKey },
    (old) => {
      if (!old) return old;
      if (old.notifications.some((n) => n.id === notification.id)) return old;
      return {
        ...old,
        notifications: [notification, ...old.notifications].slice(0, 100),
        total: old.total + 1,
        unreadCount: notification.read ? old.unreadCount : old.unreadCount + 1,
      };
    },
  );

  // Increment unread count cache
  if (!notification.read) {
    const unreadCountQueryKey = notificationsControllerGetUnreadCountQueryKey();
    queryClient.setQueryData(
      unreadCountQueryKey,
      (old: UnreadCountResponseDto | undefined) => {
        if (!old) return { count: 1 };
        return { count: old.count + 1 };
      },
    );
  }

  // Increment mentionCount in read-receipts cache for mention-type notifications
  const isMentionType =
    payload.type === NotificationType.USER_MENTION ||
    payload.type === NotificationType.SPECIAL_MENTION ||
    payload.type === NotificationType.DIRECT_MESSAGE;

  if (isMentionType && !notification.read) {
    const contextId = payload.channelId || payload.directMessageGroupId;
    if (contextId) {
      const unreadCountsQueryKey = readReceiptsControllerGetUnreadCountsQueryKey();
      queryClient.setQueryData(
        unreadCountsQueryKey,
        (old: UnreadCountDto[] | undefined) => {
          if (!old) return old;
          const index = old.findIndex(
            (c) => (c.channelId || c.directMessageGroupId) === contextId,
          );
          if (index >= 0) {
            const next = [...old];
            next[index] = {
              ...next[index],
              mentionCount: next[index].mentionCount + 1,
            };
            return next;
          }
          return [
            ...old,
            {
              channelId: payload.channelId || undefined,
              directMessageGroupId: payload.directMessageGroupId || undefined,
              unreadCount: 0,
              mentionCount: 1,
            },
          ];
        },
      );
    }
  }
};

export const handleNotificationRead: SocketEventHandler<typeof ServerEvents.NOTIFICATION_READ> = (
  payload: NotificationReadPayload,
  queryClient: QueryClient,
) => {
  const notificationsQueryKey = notificationsControllerGetNotificationsQueryKey();
  let readNotification: NotificationDto | undefined;

  queryClient.setQueriesData<NotificationListResponseDto>(
    { queryKey: notificationsQueryKey },
    (old) => {
      if (!old) return old;
      const notification = old.notifications.find((n) => n.id === payload.notificationId);
      if (!notification || notification.read) return old;
      readNotification = notification;
      return {
        ...old,
        notifications: old.notifications.map((n) =>
          n.id === payload.notificationId ? { ...n, read: true } : n,
        ),
        unreadCount: Math.max(0, old.unreadCount - 1),
      };
    },
  );

  // Decrement unread count cache
  const unreadCountQueryKey = notificationsControllerGetUnreadCountQueryKey();
  queryClient.setQueryData(
    unreadCountQueryKey,
    (old: UnreadCountResponseDto | undefined) => {
      if (!old) return old;
      return { count: Math.max(0, old.count - 1) };
    },
  );

  // Decrement mentionCount if this was a mention-type notification
  if (readNotification) {
    const isMentionType =
      readNotification.type === NotificationType.USER_MENTION ||
      readNotification.type === NotificationType.SPECIAL_MENTION ||
      readNotification.type === NotificationType.DIRECT_MESSAGE;

    if (isMentionType) {
      const contextId = readNotification.channelId || readNotification.directMessageGroupId;
      if (contextId) {
        const unreadCountsQueryKey = readReceiptsControllerGetUnreadCountsQueryKey();
        queryClient.setQueryData(
          unreadCountsQueryKey,
          (old: UnreadCountDto[] | undefined) => {
            if (!old) return old;
            const index = old.findIndex(
              (c) => (c.channelId || c.directMessageGroupId) === contextId,
            );
            if (index < 0) return old;
            const next = [...old];
            next[index] = {
              ...next[index],
              mentionCount: Math.max(0, next[index].mentionCount - 1),
            };
            return next;
          },
        );
      }
    }
  }
};

/**
 * Notifications were marked read in bulk: mark-all-read, or the mentions of a
 * channel/DM whose read receipt was just advanced. The payload names the scope
 * rather than the rows (a read-all can cover many), so the list and the badge
 * are both refetched instead of patched.
 */
export const handleNotificationsRead: SocketEventHandler<
  typeof ServerEvents.NOTIFICATIONS_READ
> = (_payload: NotificationsReadPayload, queryClient: QueryClient) => {
  queryClient.invalidateQueries({
    queryKey: notificationsControllerGetNotificationsQueryKey(),
  });
  queryClient.invalidateQueries({
    queryKey: notificationsControllerGetUnreadCountQueryKey(),
  });
};

/**
 * One notification was dismissed: the list loses the row (the badge does not
 * change, since a dismissal is not a read). Refetch both, like the bulk event,
 * so a client that filters dismissed rows server-side stays correct.
 */
export const handleNotificationDismissed: SocketEventHandler<
  typeof ServerEvents.NOTIFICATION_DISMISSED
> = (_payload: NotificationDismissedPayload, queryClient: QueryClient) => {
  queryClient.invalidateQueries({
    queryKey: notificationsControllerGetNotificationsQueryKey(),
  });
  queryClient.invalidateQueries({
    queryKey: notificationsControllerGetUnreadCountQueryKey(),
  });
};
