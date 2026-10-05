import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  handleRoleCreated,
  handleRoleUpdated,
  handleRoleDeleted,
  handleRoleAssigned,
  handleRoleUnassigned,
} from '../../../socket-hub/handlers/roleHandlers';

describe('roleHandlers', () => {
  let queryClient: QueryClient;
  let invalidateSpy: MockInstance<QueryClient['invalidateQueries']>;

  beforeEach(() => {
    queryClient = new QueryClient();
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  });

  function queryKeysInvalidated(): string[] {
    return invalidateSpy.mock.calls.map(
      (call) => ((call[0] as { queryKey: [{ _id: string }] }).queryKey[0] as { _id: string })._id,
    );
  }

  describe('handleRoleCreated', () => {
    it('invalidates the community roles list', () => {
      handleRoleCreated({} as never, queryClient);

      expect(queryKeysInvalidated()).toContain('rolesControllerGetCommunityRoles');
    });

    it('does NOT invalidate my roles or legacy members (no assignment change)', () => {
      handleRoleCreated({} as never, queryClient);

      const keys = queryKeysInvalidated();
      expect(keys).not.toContain('rolesControllerGetMyRolesForCommunity');
      expect(keys).not.toContain('membershipControllerGetMembers');
      // Invalidates community roles + membership (roles included in membership response)
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleRoleUpdated', () => {
    it('invalidates community roles and my roles', () => {
      handleRoleUpdated({} as never, queryClient);

      const keys = queryKeysInvalidated();
      expect(keys).toContain('rolesControllerGetCommunityRoles');
      expect(keys).toContain('rolesControllerGetMyRolesForCommunity');
    });

    it('does NOT invalidate legacy members (permissions may change but no role reassignment)', () => {
      handleRoleUpdated({} as never, queryClient);

      const keys = queryKeysInvalidated();
      expect(keys).not.toContain('membershipControllerGetMembers');
      // Invalidates community roles + my roles + membership + the 5
      // channel-permission queries (effective permissions depend on roles)
      expect(invalidateSpy).toHaveBeenCalledTimes(8);
    });
  });

  describe('handleRoleDeleted', () => {
    it('invalidates community roles and my roles', () => {
      handleRoleDeleted({} as never, queryClient);

      const keys = queryKeysInvalidated();
      expect(keys).toContain('rolesControllerGetCommunityRoles');
      expect(keys).toContain('rolesControllerGetMyRolesForCommunity');
      expect(keys).toContain('membershipControllerFindAllForCommunity');
      expect(invalidateSpy).toHaveBeenCalledTimes(8);
    });
  });

  describe('handleRoleAssigned', () => {
    it('invalidates community roles, my roles, AND members', () => {
      handleRoleAssigned({} as never, queryClient);

      const keys = queryKeysInvalidated();
      expect(keys).toContain('rolesControllerGetCommunityRoles');
      expect(keys).toContain('rolesControllerGetMyRolesForCommunity');
      expect(keys).toContain('membershipControllerGetMembers');
      expect(keys).toContain('membershipControllerFindAllForCommunity');
      expect(invalidateSpy).toHaveBeenCalledTimes(9);
    });
  });

  describe('handleRoleUnassigned', () => {
    it('invalidates community roles, my roles, AND members', () => {
      handleRoleUnassigned({} as never, queryClient);

      const keys = queryKeysInvalidated();
      expect(keys).toContain('rolesControllerGetCommunityRoles');
      expect(keys).toContain('rolesControllerGetMyRolesForCommunity');
      expect(keys).toContain('membershipControllerGetMembers');
      expect(keys).toContain('membershipControllerFindAllForCommunity');
      expect(invalidateSpy).toHaveBeenCalledTimes(9);
    });
  });

  describe('channel permissions follow role changes', () => {
    it.each([
      ['handleRoleUpdated', handleRoleUpdated],
      ['handleRoleDeleted', handleRoleDeleted],
      ['handleRoleAssigned', handleRoleAssigned],
      ['handleRoleUnassigned', handleRoleUnassigned],
    ])('%s invalidates channel roles and effective channel permissions', (_name, handler) => {
      handler({} as never, queryClient);

      const keys = queryKeysInvalidated();
      expect(keys).toContain('rolesControllerGetMyRolesForChannel');
      expect(keys).toContain('channelPermissionsControllerGetMyCommunityChannelPermissions');
      expect(keys).toContain('channelPermissionsControllerGetMyChannelPermissions');
    });
  });
});
