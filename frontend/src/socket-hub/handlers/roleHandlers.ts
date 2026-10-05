import type { QueryClient } from '@tanstack/react-query';
import type { ServerEvents } from '@semaphore-chat/shared';
import type { SocketEventHandler } from './types';
import { invalidateChannelPermissionQueries } from './communityHandlers';

/**
 * Invalidate membership queries so the member list re-fetches roles.
 * Membership responses now include user roles, so any role change
 * (create/update/delete/assign/unassign) should refresh membership data.
 */
function invalidateMembershipQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'membershipControllerFindAllForCommunity' }] });
}

export const handleRoleCreated: SocketEventHandler<typeof ServerEvents.ROLE_CREATED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetCommunityRoles' }] });
  invalidateMembershipQueries(queryClient);
};

export const handleRoleUpdated: SocketEventHandler<typeof ServerEvents.ROLE_UPDATED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetCommunityRoles' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetMyRolesForCommunity' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetMyRolesForChannel' }] });
  invalidateChannelPermissionQueries(queryClient);
  invalidateMembershipQueries(queryClient);
};

export const handleRoleDeleted: SocketEventHandler<typeof ServerEvents.ROLE_DELETED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetCommunityRoles' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetMyRolesForCommunity' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetMyRolesForChannel' }] });
  invalidateChannelPermissionQueries(queryClient);
  invalidateMembershipQueries(queryClient);
};

export const handleRoleAssigned: SocketEventHandler<typeof ServerEvents.ROLE_ASSIGNED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetCommunityRoles' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetMyRolesForCommunity' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'membershipControllerGetMembers' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetMyRolesForChannel' }] });
  invalidateChannelPermissionQueries(queryClient);
  invalidateMembershipQueries(queryClient);
};

export const handleRoleUnassigned: SocketEventHandler<typeof ServerEvents.ROLE_UNASSIGNED> = (
  _payload,
  queryClient: QueryClient,
) => {
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetCommunityRoles' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetMyRolesForCommunity' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'membershipControllerGetMembers' }] });
  queryClient.invalidateQueries({ queryKey: [{ _id: 'rolesControllerGetMyRolesForChannel' }] });
  invalidateChannelPermissionQueries(queryClient);
  invalidateMembershipQueries(queryClient);
};
