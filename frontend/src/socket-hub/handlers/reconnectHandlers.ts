import type { QueryClient, InfiniteData } from '@tanstack/react-query';
import {
  readReceiptsControllerGetUnreadCountsQueryKey,
  notificationsControllerGetUnreadCountQueryKey,
  notificationsControllerGetNotificationsQueryKey,
  presenceControllerGetBulkPresenceQueryKey,
} from '../../api-client/@tanstack/react-query.gen';
import type { PaginatedMessagesResponseDto } from '../../api-client/types.gen';
import { isDetachedFromLiveEdge } from '../../utils/messageCacheUpdaters';

/**
 * Consolidated reconnect handler. After a socket reconnect, invalidate all
 * caches that may have missed updates during the disconnect gap.
 */
export function handleReconnect(queryClient: QueryClient): void {
  // Messages. A detached window (newest page evicted at MESSAGE_MAX_PAGES)
  // cannot be recovered by invalidation — the refetch replays the stored
  // cursors, which no longer include the live edge. Reset those instead.
  for (const _id of [
    'messagesControllerFindAllForChannel',
    'messagesControllerFindAllForGroup',
  ]) {
    for (const query of queryClient.getQueryCache().findAll({ queryKey: [{ _id }] })) {
      const data = query.state.data as
        | InfiniteData<PaginatedMessagesResponseDto>
        | undefined;
      if (isDetachedFromLiveEdge(data)) {
        void queryClient.resetQueries({ queryKey: query.queryKey, exact: true });
      } else {
        void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
      }
    }
  }

  // Read receipts
  queryClient.invalidateQueries({
    queryKey: readReceiptsControllerGetUnreadCountsQueryKey(),
  });
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'readReceiptsControllerGetDmPeerReads' }],
  });

  // Notifications
  queryClient.invalidateQueries({
    queryKey: notificationsControllerGetUnreadCountQueryKey(),
  });
  queryClient.invalidateQueries({
    queryKey: notificationsControllerGetNotificationsQueryKey(),
  });

  // Online presence: USER_OFFLINE / USER_ONLINE missed during the gap would
  // otherwise show people in the wrong state until the 60 s stale time lapses.
  // One key serves every member list (bulk presence).
  queryClient.invalidateQueries({
    queryKey: presenceControllerGetBulkPresenceQueryKey(),
  });

  // Voice presence (safety net for missed events during disconnect)
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'voicePresenceControllerGetChannelPresence' }],
  });
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'dmVoicePresenceControllerGetDmPresence' }],
  });
}
