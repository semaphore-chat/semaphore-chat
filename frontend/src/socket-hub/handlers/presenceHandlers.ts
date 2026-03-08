import type { QueryClient } from '@tanstack/react-query';
import type { UserPresenceInfo, UserProfileUpdatedPayload, ServerEvents } from '@semaphore-chat/shared';
import type { UserControllerGetProfileResponse } from '../../api-client';
import {
  presenceControllerGetUserPresenceQueryKey,
  presenceControllerGetBulkPresenceQueryKey,
  userControllerGetUserByIdQueryKey,
  userControllerGetProfileQueryKey,
} from '../../api-client/@tanstack/react-query.gen';
import type { SocketEventHandler } from './types';

export const handleUserOnline: SocketEventHandler<typeof ServerEvents.USER_ONLINE> = (
  data: UserPresenceInfo,
  queryClient: QueryClient,
) => {
  queryClient.setQueryData(
    presenceControllerGetUserPresenceQueryKey({ path: { userId: data.userId } }),
    (old: { isOnline: boolean } | undefined) => (old ? { ...old, isOnline: true } : old),
  );

  queryClient.setQueryData(
    presenceControllerGetBulkPresenceQueryKey(),
    (old: { presence: Record<string, boolean> } | undefined) => {
      if (!old) return old;
      return { ...old, presence: { ...old.presence, [data.userId]: true } };
    },
  );

  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      if (typeof key === 'object' && key !== null && '_id' in key) {
        return (key as { _id: string })._id === 'presenceControllerGetMultipleUserPresence';
      }
      return false;
    },
  });
};

export const handleUserOffline: SocketEventHandler<typeof ServerEvents.USER_OFFLINE> = (
  data: UserPresenceInfo,
  queryClient: QueryClient,
) => {
  queryClient.setQueryData(
    presenceControllerGetUserPresenceQueryKey({ path: { userId: data.userId } }),
    (old: { isOnline: boolean } | undefined) => (old ? { ...old, isOnline: false } : old),
  );

  queryClient.setQueryData(
    presenceControllerGetBulkPresenceQueryKey(),
    (old: { presence: Record<string, boolean> } | undefined) => {
      if (!old) return old;
      return { ...old, presence: { ...old.presence, [data.userId]: false } };
    },
  );

  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      if (typeof key === 'object' && key !== null && '_id' in key) {
        return (key as { _id: string })._id === 'presenceControllerGetMultipleUserPresence';
      }
      return false;
    },
  });
};

// =============================================================================
// User Profile Update
// =============================================================================

export const handleUserProfileUpdated: SocketEventHandler<typeof ServerEvents.USER_PROFILE_UPDATED> = (
  payload: UserProfileUpdatedPayload,
  queryClient: QueryClient,
) => {
  // Only invalidate the current user's own profile query if they are the one who updated
  const currentUser = queryClient.getQueryData<UserControllerGetProfileResponse>(
    userControllerGetProfileQueryKey(),
  );
  if (currentUser && payload.userId === currentUser.id) {
    queryClient.invalidateQueries({ queryKey: [{ _id: 'userControllerGetProfile' }] });
  }

  // Invalidate the useUser() cache for this user so all UserAvatar
  // instances and other components showing this user's data refresh
  queryClient.invalidateQueries({
    queryKey: userControllerGetUserByIdQueryKey({ path: { id: payload.userId } }),
  });
};
