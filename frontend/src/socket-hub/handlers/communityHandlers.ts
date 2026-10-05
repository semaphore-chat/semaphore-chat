import type { QueryClient } from '@tanstack/react-query';
import type { ServerEvents } from '@semaphore-chat/shared';
import type { SocketEventHandler } from './types';

export const handleMemberAddedToCommunity: SocketEventHandler<typeof ServerEvents.MEMBER_ADDED_TO_COMMUNITY> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'communityControllerFindAllMine' }],
  });
};

// =============================================================================
// Channel Reorder
// =============================================================================

export const handleChannelsReordered: SocketEventHandler<typeof ServerEvents.CHANNELS_REORDERED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'channelsControllerFindAllForCommunity' }],
  });
};

// =============================================================================
// Channel Lifecycle
// =============================================================================

export const handleChannelCreated: SocketEventHandler<typeof ServerEvents.CHANNEL_CREATED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'channelsControllerFindAllForCommunity' }],
  });
};

export const handleChannelUpdated: SocketEventHandler<typeof ServerEvents.CHANNEL_UPDATED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'channelsControllerFindAllForCommunity' }],
  });
};

export const handleChannelDeleted: SocketEventHandler<typeof ServerEvents.CHANNEL_DELETED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'channelsControllerFindAllForCommunity' }],
  });
};

/**
 * A channel's overwrites (or privacy) changed: refetch the channel list (it
 * may appear or disappear), the single-channel query (it carries `preset`,
 * which the composer needs for the "read-only" notice copy) and the
 * effective channel permissions.
 */
export const handleChannelPermissionsUpdated: SocketEventHandler<
  typeof ServerEvents.CHANNEL_PERMISSIONS_UPDATED
> = (payload, queryClient: QueryClient) => {
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'channelsControllerFindAllForCommunity' }],
  });
  // Only the changed channel's detail query (keys match on a subset)
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'channelsControllerFindOne', path: { id: payload.channelId } }],
  });
  invalidateChannelPermissionQueries(queryClient);
};

/** Effective channel permissions depend on roles, overwrites and timeouts. */
export function invalidateChannelPermissionQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'channelPermissionsControllerGetMyCommunityChannelPermissions' }],
  });
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'channelPermissionsControllerGetMyChannelPermissions' }],
  });
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'channelPermissionsControllerListChannelPermissions' }],
  });
  queryClient.invalidateQueries({
    queryKey: [{ _id: 'channelPermissionsControllerGetOverwrites' }],
  });
}

// =============================================================================
// Community Lifecycle
// =============================================================================

export const handleCommunityUpdated: SocketEventHandler<typeof ServerEvents.COMMUNITY_UPDATED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'communityControllerFindOne' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'communityControllerFindAllMine' }] });
};

export const handleCommunityDeleted: SocketEventHandler<typeof ServerEvents.COMMUNITY_DELETED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'communityControllerFindAllMine' }] });
};
