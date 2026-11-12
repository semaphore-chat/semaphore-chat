import type { QueryClient } from '@tanstack/react-query';
import type { ServerEvents } from '@semaphore-chat/shared';
import type { SocketEventHandler } from './types';
import { invalidateDmGroupQueries } from '../../utils/queryInvalidation';

/**
 * A group was created, gained members or lost one. The payload carries ids
 * only: the DM list refetches (a row appears, is reordered, or loses its
 * "left" member) and so does the single group, whose response carries the
 * member list the web renders as participants.
 */
export const handleDmGroupCreated: SocketEventHandler<
  typeof ServerEvents.DM_GROUP_CREATED
> = (_payload, queryClient: QueryClient) => {
  invalidateDmGroupQueries(queryClient);
};

export const handleDmGroupMemberAdded: SocketEventHandler<
  typeof ServerEvents.DM_GROUP_MEMBER_ADDED
> = (_payload, queryClient: QueryClient) => {
  invalidateDmGroupQueries(queryClient);
};

export const handleDmGroupMemberLeft: SocketEventHandler<
  typeof ServerEvents.DM_GROUP_MEMBER_LEFT
> = (_payload, queryClient: QueryClient) => {
  invalidateDmGroupQueries(queryClient);
};
