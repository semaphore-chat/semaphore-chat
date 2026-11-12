import type { QueryClient } from '@tanstack/react-query';
import type { ServerEvents } from '@semaphore-chat/shared';
import type { SocketEventHandler } from './types';
import { invalidateChannelPermissionQueries } from './communityHandlers';
import { invalidateModerationQueries } from '../../utils/queryInvalidation';

export const handleUserBanned: SocketEventHandler<typeof ServerEvents.USER_BANNED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'membershipControllerFindAllForCommunity' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'communityControllerFindAllMine' }] });
  // Moderators watching the lists and the log: this action added an entry.
  invalidateModerationQueries(queryClient);
};

/**
 * A ban was lifted: the ban list and the moderation log both have a new entry.
 * The membership list does not change (the user has to rejoin).
 */
export const handleUserUnbanned: SocketEventHandler<typeof ServerEvents.USER_UNBANNED> = (
  _payload,
  queryClient: QueryClient,
) => {
  invalidateModerationQueries(queryClient);
};

export const handleUserKicked: SocketEventHandler<typeof ServerEvents.USER_KICKED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'membershipControllerFindAllForCommunity' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'communityControllerFindAllMine' }] });
  // Moderators watching the lists and the log: this action added an entry.
  invalidateModerationQueries(queryClient);
};

export const handleUserTimedOut: SocketEventHandler<typeof ServerEvents.USER_TIMED_OUT> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'membershipControllerFindAllForCommunity' }] });
  // The composer reads this to show / clear its timeout notice.
  queryClient.invalidateQueries({ queryKey: [{ _id: 'moderationControllerGetTimeoutStatus' }] });
  // A timeout takes posting, reacting and voice publishing away (and its
  // removal gives them back): refetch the effective channel permissions.
  invalidateChannelPermissionQueries(queryClient);
  // Moderators watching the lists and the log: this action added an entry.
  invalidateModerationQueries(queryClient);
};

export const handleTimeoutRemoved: SocketEventHandler<typeof ServerEvents.TIMEOUT_REMOVED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'membershipControllerFindAllForCommunity' }] });
  // The composer reads this to show / clear its timeout notice.
  queryClient.invalidateQueries({ queryKey: [{ _id: 'moderationControllerGetTimeoutStatus' }] });
  // Moderators watching the timeout list (a list entry is gone, whether the
  // timeout was lifted early or ran out on its own).
  queryClient.invalidateQueries({ queryKey: [{ _id: 'moderationControllerGetTimeoutList' }] });
  // A timeout takes posting, reacting and voice publishing away (and its
  // removal gives them back): refetch the effective channel permissions.
  invalidateChannelPermissionQueries(queryClient);
  // Moderators watching the lists and the log: this action added an entry.
  invalidateModerationQueries(queryClient);
};
