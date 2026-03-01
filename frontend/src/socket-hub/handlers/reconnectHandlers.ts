import type { QueryClient } from '@tanstack/react-query';
import {
  readReceiptsControllerGetUnreadCountsQueryKey,
  notificationsControllerGetUnreadCountQueryKey,
  notificationsControllerGetNotificationsQueryKey,
} from '../../api-client/@tanstack/react-query.gen';

/**
 * Consolidated reconnect handler. After a socket reconnect, invalidate all
 * caches that may have missed updates during the disconnect gap.
 */
export function handleReconnect(queryClient: QueryClient): void {
  // Messages
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'messagesControllerFindAllForChannel' }],
  });
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'messagesControllerFindAllForGroup' }],
  });

  // Read receipts
  queryClient.invalidateQueries({
    queryKey: readReceiptsControllerGetUnreadCountsQueryKey(),
  });
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'readReceiptsControllerGetMessageReaders' }],
  });

  // Notifications
  queryClient.invalidateQueries({
    queryKey: notificationsControllerGetUnreadCountQueryKey(),
  });
  queryClient.invalidateQueries({
    queryKey: notificationsControllerGetNotificationsQueryKey(),
  });

  // Voice presence (safety net for missed events during disconnect)
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'voicePresenceControllerGetChannelPresence' }],
  });
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'dmVoicePresenceControllerGetDmPresence' }],
  });
}
