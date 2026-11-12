import { RbacActions } from '@prisma/client';
import {
  DEFAULT_ADMIN_ROLE,
  DEFAULT_MODERATOR_ROLE,
  DEFAULT_MEMBER_ROLE,
  getDefaultCommunityRoles,
} from './default-roles.config';

describe('Default Roles Config', () => {
  describe('DEFAULT_ADMIN_ROLE', () => {
    it('should have correct name', () => {
      expect(DEFAULT_ADMIN_ROLE.name).toBe('Community Admin');
    });

    it('should have all admin permissions', () => {
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(
        RbacActions.UPDATE_COMMUNITY,
      );
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(
        RbacActions.DELETE_COMMUNITY,
      );
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(RbacActions.CREATE_CHANNEL);
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(RbacActions.DELETE_CHANNEL);
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(RbacActions.CREATE_ROLE);
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(RbacActions.DELETE_ROLE);
    });

    it('should have voice channel permissions', () => {
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(RbacActions.JOIN_CHANNEL);
    });

    it('should have invite management permissions', () => {
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(RbacActions.CREATE_INVITE);
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(RbacActions.DELETE_INVITE);
    });

    it('should have community moderation permissions, including banning', () => {
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(RbacActions.BAN_USER);
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(RbacActions.KICK_USER);
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(RbacActions.TIMEOUT_USER);
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(RbacActions.UNBAN_USER);
      expect(DEFAULT_ADMIN_ROLE.actions).toContain(RbacActions.VIEW_BAN_LIST);
    });

    it('should NOT have instance-level actions', () => {
      expect(DEFAULT_ADMIN_ROLE.actions).not.toContain(
        RbacActions.READ_INSTANCE_SETTINGS,
      );
      expect(DEFAULT_ADMIN_ROLE.actions).not.toContain(
        RbacActions.UPDATE_INSTANCE_SETTINGS,
      );
      expect(DEFAULT_ADMIN_ROLE.actions).not.toContain(
        RbacActions.READ_INSTANCE_STATS,
      );
      expect(DEFAULT_ADMIN_ROLE.actions).not.toContain(RbacActions.READ_USER);
      expect(DEFAULT_ADMIN_ROLE.actions).not.toContain(RbacActions.UPDATE_USER);
      expect(DEFAULT_ADMIN_ROLE.actions).not.toContain(RbacActions.DELETE_USER);
      expect(DEFAULT_ADMIN_ROLE.actions).not.toContain(
        RbacActions.CREATE_INSTANCE_INVITE,
      );
      expect(DEFAULT_ADMIN_ROLE.actions).not.toContain(
        RbacActions.DELETE_INSTANCE_INVITE,
      );
      expect(DEFAULT_ADMIN_ROLE.actions).not.toContain(
        RbacActions.READ_INSTANCE_INVITE,
      );
    });

    it('should be an array with multiple actions', () => {
      expect(Array.isArray(DEFAULT_ADMIN_ROLE.actions)).toBe(true);
      expect(DEFAULT_ADMIN_ROLE.actions.length).toBeGreaterThan(20);
    });
  });

  describe('DEFAULT_MODERATOR_ROLE', () => {
    it('should have correct name', () => {
      expect(DEFAULT_MODERATOR_ROLE.name).toBe('Moderator');
    });

    it('should have read permissions', () => {
      expect(DEFAULT_MODERATOR_ROLE.actions).toContain(
        RbacActions.READ_COMMUNITY,
      );
      expect(DEFAULT_MODERATOR_ROLE.actions).toContain(
        RbacActions.READ_CHANNEL,
      );
      expect(DEFAULT_MODERATOR_ROLE.actions).toContain(RbacActions.READ_MEMBER);
      expect(DEFAULT_MODERATOR_ROLE.actions).toContain(
        RbacActions.READ_MESSAGE,
      );
    });

    it('should have message moderation permissions', () => {
      expect(DEFAULT_MODERATOR_ROLE.actions).toContain(
        RbacActions.CREATE_MESSAGE,
      );
      expect(DEFAULT_MODERATOR_ROLE.actions).toContain(
        RbacActions.DELETE_MESSAGE,
      );
    });

    it('should have limited channel management', () => {
      expect(DEFAULT_MODERATOR_ROLE.actions).toContain(
        RbacActions.CREATE_CHANNEL,
      );
      expect(DEFAULT_MODERATOR_ROLE.actions).toContain(
        RbacActions.UPDATE_CHANNEL,
      );
      expect(DEFAULT_MODERATOR_ROLE.actions).not.toContain(
        RbacActions.DELETE_CHANNEL,
      );
    });

    it('should not have role management permissions', () => {
      expect(DEFAULT_MODERATOR_ROLE.actions).not.toContain(
        RbacActions.CREATE_ROLE,
      );
      expect(DEFAULT_MODERATOR_ROLE.actions).not.toContain(
        RbacActions.DELETE_ROLE,
      );
    });

    it('should have fewer permissions than admin', () => {
      expect(DEFAULT_MODERATOR_ROLE.actions.length).toBeLessThan(
        DEFAULT_ADMIN_ROLE.actions.length,
      );
    });
  });

  describe('DEFAULT_MEMBER_ROLE', () => {
    it('should have correct name', () => {
      expect(DEFAULT_MEMBER_ROLE.name).toBe('Member');
    });

    it('should have basic read permissions', () => {
      expect(DEFAULT_MEMBER_ROLE.actions).toContain(RbacActions.READ_COMMUNITY);
      expect(DEFAULT_MEMBER_ROLE.actions).toContain(RbacActions.READ_CHANNEL);
      expect(DEFAULT_MEMBER_ROLE.actions).toContain(RbacActions.READ_MEMBER);
      expect(DEFAULT_MEMBER_ROLE.actions).toContain(RbacActions.READ_MESSAGE);
    });

    it('should have message creation permission', () => {
      expect(DEFAULT_MEMBER_ROLE.actions).toContain(RbacActions.CREATE_MESSAGE);
    });

    it('should not have message deletion permission', () => {
      expect(DEFAULT_MEMBER_ROLE.actions).not.toContain(
        RbacActions.DELETE_MESSAGE,
      );
    });

    it('should have voice channel permission', () => {
      expect(DEFAULT_MEMBER_ROLE.actions).toContain(RbacActions.JOIN_CHANNEL);
    });

    it('should have reaction permissions', () => {
      expect(DEFAULT_MEMBER_ROLE.actions).toContain(
        RbacActions.CREATE_REACTION,
      );
      expect(DEFAULT_MEMBER_ROLE.actions).toContain(
        RbacActions.DELETE_REACTION,
      );
    });

    it('should not have admin or moderator permissions', () => {
      expect(DEFAULT_MEMBER_ROLE.actions).not.toContain(
        RbacActions.DELETE_COMMUNITY,
      );
      expect(DEFAULT_MEMBER_ROLE.actions).not.toContain(
        RbacActions.CREATE_CHANNEL,
      );
      expect(DEFAULT_MEMBER_ROLE.actions).not.toContain(
        RbacActions.DELETE_CHANNEL,
      );
      expect(DEFAULT_MEMBER_ROLE.actions).not.toContain(
        RbacActions.CREATE_ROLE,
      );
    });

    it('should have fewer permissions than moderator', () => {
      expect(DEFAULT_MEMBER_ROLE.actions.length).toBeLessThan(
        DEFAULT_MODERATOR_ROLE.actions.length,
      );
    });
  });

  describe('getDefaultCommunityRoles', () => {
    it('should return all three default roles', () => {
      const roles = getDefaultCommunityRoles();

      expect(roles).toHaveLength(3);
      expect(roles).toContain(DEFAULT_ADMIN_ROLE);
      expect(roles).toContain(DEFAULT_MODERATOR_ROLE);
      expect(roles).toContain(DEFAULT_MEMBER_ROLE);
    });

    it('should return roles in correct order', () => {
      const roles = getDefaultCommunityRoles();

      expect(roles[0]).toBe(DEFAULT_ADMIN_ROLE);
      expect(roles[1]).toBe(DEFAULT_MODERATOR_ROLE);
      expect(roles[2]).toBe(DEFAULT_MEMBER_ROLE);
    });

    it('should return a new array each time', () => {
      const roles1 = getDefaultCommunityRoles();
      const roles2 = getDefaultCommunityRoles();

      expect(roles1).toEqual(roles2);
      expect(roles1).not.toBe(roles2);
    });
  });

  describe('Role Permission Hierarchy', () => {
    it('should have admin with most permissions', () => {
      expect(DEFAULT_ADMIN_ROLE.actions.length).toBeGreaterThan(
        DEFAULT_MODERATOR_ROLE.actions.length,
      );
      expect(DEFAULT_ADMIN_ROLE.actions.length).toBeGreaterThan(
        DEFAULT_MEMBER_ROLE.actions.length,
      );
    });

    it('should have moderator with more permissions than member', () => {
      expect(DEFAULT_MODERATOR_ROLE.actions.length).toBeGreaterThan(
        DEFAULT_MEMBER_ROLE.actions.length,
      );
    });

    it('should have all member permissions in moderator role', () => {
      const moderatorActions = new Set(DEFAULT_MODERATOR_ROLE.actions);

      DEFAULT_MEMBER_ROLE.actions.forEach((action) => {
        expect(moderatorActions.has(action)).toBe(true);
      });
    });

    it('should have unique permissions for each role', () => {
      const adminSet = new Set(DEFAULT_ADMIN_ROLE.actions);
      const moderatorSet = new Set(DEFAULT_MODERATOR_ROLE.actions);
      const memberSet = new Set(DEFAULT_MEMBER_ROLE.actions);

      expect(adminSet.size).toBe(DEFAULT_ADMIN_ROLE.actions.length);
      expect(moderatorSet.size).toBe(DEFAULT_MODERATOR_ROLE.actions.length);
      expect(memberSet.size).toBe(DEFAULT_MEMBER_ROLE.actions.length);
    });
  });
});
