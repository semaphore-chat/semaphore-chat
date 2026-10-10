import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  messagesControllerFindAllForChannel,
  messagesControllerFindAllForGroup,
  readReceiptsControllerMarkAsRead,
} from '../api-client/sdk.gen';
import { readReceiptsControllerGetUnreadCountsQueryKey } from '../api-client/@tanstack/react-query.gen';
import type { PaginatedMessagesResponseDto, UnreadCountDto } from '../api-client/types.gen';
import { channelMessagesQueryKey, dmMessagesQueryKey } from './messageQueryKeys';
import { isDetachedFromLiveEdge, isOptimisticMessageId } from './messageCacheUpdaters';

export type ConversationKind = 'channel' | 'dm';

function newestConfirmedId(messages: readonly { id: string }[] | undefined): string | undefined {
  return messages?.find((m) => !isOptimisticMessageId(m.id))?.id;
}

/**
 * Mark a channel or DM read up to its newest message (the Esc shortcut).
 *
 * Does nothing when it has no unread messages. The newest message comes from
 * the live messages cache; when the window is scrolled back into history
 * (detached from the live edge) or not cached, it is fetched (one message).
 * Clears the unread and mention counts in the cache before the request, the
 * same optimistic update scrolling to the bottom makes.
 *
 * @returns whether a read mark was sent.
 */
export async function markConversationRead(
  queryClient: QueryClient,
  kind: ConversationKind,
  id: string,
): Promise<boolean> {
  const unreadKey = readReceiptsControllerGetUnreadCountsQueryKey();
  const counts = queryClient.getQueryData<UnreadCountDto[]>(unreadKey);
  const entry = counts?.find((c) => (c.channelId || c.directMessageGroupId) === id);
  if (!entry || (entry.unreadCount ?? 0) === 0) return false;

  const messagesKey = kind === 'channel' ? channelMessagesQueryKey(id) : dmMessagesQueryKey(id);
  const cached = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(messagesKey);
  let newestId = cached && !isDetachedFromLiveEdge(cached) ? newestConfirmedId(cached.pages[0]?.messages) : undefined;

  if (!newestId) {
    const { data } =
      kind === 'channel'
        ? await messagesControllerFindAllForChannel({ path: { channelId: id }, query: { limit: 1 }, throwOnError: true })
        : await messagesControllerFindAllForGroup({ path: { groupId: id }, query: { limit: 1 }, throwOnError: true });
    newestId = newestConfirmedId(data?.messages);
  }
  if (!newestId) return false;

  queryClient.setQueryData<UnreadCountDto[]>(unreadKey, (old) =>
    old?.map((c) =>
      (c.channelId || c.directMessageGroupId) === id
        ? { ...c, unreadCount: 0, mentionCount: 0, lastReadMessageId: newestId, lastReadAt: new Date().toISOString() }
        : c,
    ),
  );

  await readReceiptsControllerMarkAsRead({
    body: {
      lastReadMessageId: newestId,
      ...(kind === 'channel' ? { channelId: id } : { directMessageGroupId: id }),
    },
    throwOnError: true,
  });
  return true;
}
