import type { QueryClient } from '@tanstack/react-query';
import type { ServerEvents } from '@semaphore-chat/shared';
import type { SocketEventHandler } from './types';

export const handleUserBanned: SocketEventHandler<typeof ServerEvents.USER_BANNED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'membershipControllerGetMembers' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'communityControllerFindAllMine' }] });
};

export const handleUserKicked: SocketEventHandler<typeof ServerEvents.USER_KICKED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'membershipControllerGetMembers' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'communityControllerFindAllMine' }] });
};

export const handleUserTimedOut: SocketEventHandler<typeof ServerEvents.USER_TIMED_OUT> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'membershipControllerGetMembers' }] });
  // The composer reads this to show / clear its timeout notice.
  queryClient.invalidateQueries({ queryKey: [{ _id: 'moderationControllerGetTimeoutStatus' }] });
};

export const handleTimeoutRemoved: SocketEventHandler<typeof ServerEvents.TIMEOUT_REMOVED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'membershipControllerGetMembers' }] });
  // The composer reads this to show / clear its timeout notice.
  queryClient.invalidateQueries({ queryKey: [{ _id: 'moderationControllerGetTimeoutStatus' }] });
};
