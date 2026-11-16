/**
 * Issue #817: a mention that is the first message of a channel with no unread
 * entry. The server emits NEW_MESSAGE first; the notification row is written
 * later by the fan-out job, which emits NEW_NOTIFICATION once the row exists.
 * The message handler inserts an entry and refetches the unread counts; that
 * refetch can read the server before or after the notification row, and land
 * before or after the notification event. Every ordering must end with the
 * server's answer: one unread message, one mention.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { UnreadCountDto } from '../../../api-client';
import { readReceiptsControllerGetUnreadCountsQueryKey } from '../../../api-client/@tanstack/react-query.gen';
import { handleNewMessage } from '../../../socket-hub/handlers/messageHandlers';
import { handleNewNotification } from '../../../socket-hub/handlers/notificationHandlers';
import { NotificationType } from '../../../types/notification.type';
import type { NewNotificationPayload } from '@semaphore-chat/shared';

const key = readReceiptsControllerGetUnreadCountsQueryKey();
const other: UnreadCountDto = { channelId: 'ch-other', communityId: 'c-2', unreadCount: 1, mentionCount: 0 };
/** The server before the fan-out job wrote the notification row. */
const beforeRow: UnreadCountDto[] = [other, { channelId: 'ch-1', communityId: 'c-1', unreadCount: 1, mentionCount: 0 }];
/** The server after it: the truth every ordering must end on. */
const afterRow: UnreadCountDto[] = [other, { channelId: 'ch-1', communityId: 'c-1', unreadCount: 1, mentionCount: 1 }];

const message = {
  id: 'msg-1',
  channelId: 'ch-1',
  directMessageGroupId: null,
  authorId: 'user-b',
  spans: [{ type: 'USER_MENTION', userId: 'user-a' }],
  reactions: [],
  attachments: [],
  sentAt: '2026-11-15T00:00:00Z',
};

const notification: NewNotificationPayload = {
  notificationId: 'notif-1',
  type: NotificationType.USER_MENTION,
  messageId: 'msg-1',
  channelId: 'ch-1',
  communityId: 'c-1',
  channelName: 'lobby',
  directMessageGroupId: null,
  authorId: 'user-b',
  author: { id: 'user-b', username: 'bea', displayName: null, avatarUrl: null },
  message: { id: 'msg-1', channelId: 'ch-1', directMessageGroupId: null, spans: [] },
  createdAt: '2026-11-15T00:00:00Z',
  read: false,
};

describe('first unread message is a mention (#817)', () => {
  let queryClient: QueryClient;
  let unsubscribe: () => void;
  /** Each fetch of the unread counts, in order, answered by the test. */
  let fetches: Array<(rows: UnreadCountDto[]) => void>;

  const answer = async (index: number, rows: UnreadCountDto[]) => {
    await vi.waitFor(() => expect(fetches.length).toBeGreaterThan(index));
    fetches[index](rows);
  };
  /** Answer every fetch still to come with the server's current state, then let the cache settle. */
  const settle = async (rows: UnreadCountDto[]) => {
    for (let i = 0; i < 10 && queryClient.isFetching({ queryKey: key }) > 0; i++) {
      fetches[fetches.length - 1](rows);
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(queryClient.isFetching({ queryKey: key })).toBe(0);
  };
  const entry = () => queryClient.getQueryData<UnreadCountDto[]>(key)?.find((c) => c.channelId === 'ch-1');

  beforeEach(async () => {
    fetches = [];
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    queryClient.setQueryData(key, [other]);
    // An observer makes the query active, as the dock and the channel list do,
    // so invalidations refetch it.
    const observer = new QueryObserver<UnreadCountDto[]>(queryClient, {
      queryKey: key,
      queryFn: () => new Promise<UnreadCountDto[]>((resolve) => fetches.push(resolve)),
      staleTime: Infinity,
    });
    unsubscribe = observer.subscribe(() => {});
  });

  afterEach(() => unsubscribe());

  it('the refetch read the server before the row and lands after the notification', async () => {
    await handleNewMessage({ message: message as never }, queryClient);
    expect(queryClient.isFetching({ queryKey: key })).toBe(1);
    handleNewNotification(notification, queryClient);
    await answer(0, beforeRow);
    await settle(afterRow);
    expect(entry()).toMatchObject({ unreadCount: 1, mentionCount: 1, communityId: 'c-1' });
  });

  it('the refetch read the server before the row and lands before the notification', async () => {
    await handleNewMessage({ message: message as never }, queryClient);
    await answer(0, beforeRow);
    await settle(beforeRow);
    handleNewNotification(notification, queryClient);
    expect(entry()).toMatchObject({ mentionCount: 1 });
    await settle(afterRow);
    expect(entry()).toMatchObject({ unreadCount: 1, mentionCount: 1, communityId: 'c-1' });
  });

  it('the refetch read the server after the row and lands before the notification (no double count)', async () => {
    await handleNewMessage({ message: message as never }, queryClient);
    await answer(0, afterRow);
    await settle(afterRow);
    handleNewNotification(notification, queryClient);
    await settle(afterRow);
    expect(entry()).toMatchObject({ unreadCount: 1, mentionCount: 1, communityId: 'c-1' });
  });

  it('the refetch read the server after the row and lands after the notification', async () => {
    await handleNewMessage({ message: message as never }, queryClient);
    handleNewNotification(notification, queryClient);
    await answer(0, afterRow);
    await settle(afterRow);
    expect(entry()).toMatchObject({ unreadCount: 1, mentionCount: 1, communityId: 'c-1' });
  });

  it('the notification arrives before the message', async () => {
    handleNewNotification(notification, queryClient);
    expect(entry()).toMatchObject({ unreadCount: 0, mentionCount: 1 });
    await handleNewMessage({ message: message as never }, queryClient);
    expect(entry()).toMatchObject({ unreadCount: 1, mentionCount: 1 });
    await settle(afterRow);
    expect(entry()).toMatchObject({ unreadCount: 1, mentionCount: 1, communityId: 'c-1' });
  });
});
