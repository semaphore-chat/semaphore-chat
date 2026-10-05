import { RbacActions } from '@prisma/client';

export interface DefaultRoleConfig {
  name: string;
  position: number;
  actions: RbacActions[];
}

/**
 * Default instance admin role with all instance-level permissions
 * This role can be assigned to non-OWNER users to give them admin access
 */
export const DEFAULT_INSTANCE_ADMIN_ROLE: DefaultRoleConfig = {
  name: 'Instance Admin',
  position: 10,
  actions: [
    // Instance administration
    RbacActions.READ_INSTANCE_SETTINGS,
    RbacActions.UPDATE_INSTANCE_SETTINGS,
    RbacActions.READ_INSTANCE_STATS,
    RbacActions.MANAGE_USER_STORAGE,

    // User management
    RbacActions.READ_USER,
    RbacActions.UPDATE_USER,
    RbacActions.BAN_USER,
    RbacActions.DELETE_USER,

    // Instance invites
    RbacActions.READ_INSTANCE_INVITE,
    RbacActions.CREATE_INSTANCE_INVITE,
    RbacActions.DELETE_INSTANCE_INVITE,
    RbacActions.UPDATE_INSTANCE_INVITE,
  ],
};

/**
 * Get all valid instance-level actions
 */
export function getInstanceAdminActions(): RbacActions[] {
  return DEFAULT_INSTANCE_ADMIN_ROLE.actions;
}

/**
 * Default Community Creator role - allows users to create and manage their own communities
 * This role enables delegation of community creation without giving full admin access
 */
export const DEFAULT_COMMUNITY_CREATOR_ROLE: DefaultRoleConfig = {
  name: 'Community Creator',
  position: 20,
  actions: [
    // Community creation and full management of own communities
    RbacActions.CREATE_COMMUNITY,
    RbacActions.READ_COMMUNITY,

    // Channel management within own communities
    RbacActions.CREATE_CHANNEL,
    RbacActions.UPDATE_CHANNEL,
    RbacActions.MANAGE_CHANNEL_PERMISSIONS,
    RbacActions.MANAGE_WEBHOOKS,
    RbacActions.DELETE_CHANNEL,
    RbacActions.READ_CHANNEL,

    // Voice channel permissions
    RbacActions.JOIN_CHANNEL,
    RbacActions.SPEAK,
    RbacActions.VIDEO,
    RbacActions.SCREEN_SHARE,

    // Member management within own communities
    RbacActions.CREATE_MEMBER,
    RbacActions.UPDATE_MEMBER,
    RbacActions.DELETE_MEMBER,
    RbacActions.READ_MEMBER,

    // Message management
    RbacActions.CREATE_MESSAGE,
    RbacActions.ATTACH_FILES,
    RbacActions.DELETE_MESSAGE,
    RbacActions.READ_MESSAGE,

    // Role management within own communities
    RbacActions.CREATE_ROLE,
    RbacActions.UPDATE_ROLE,
    RbacActions.DELETE_ROLE,
    RbacActions.READ_ROLE,

    // Community invite management
    RbacActions.CREATE_INVITE,
    RbacActions.DELETE_INVITE,

    // Alias group management
    RbacActions.CREATE_ALIAS_GROUP,
    RbacActions.UPDATE_ALIAS_GROUP,
    RbacActions.DELETE_ALIAS_GROUP,
    RbacActions.READ_ALIAS_GROUP,
    RbacActions.CREATE_ALIAS_GROUP_MEMBER,
    RbacActions.DELETE_ALIAS_GROUP_MEMBER,
    RbacActions.READ_ALIAS_GROUP_MEMBER,
    RbacActions.UPDATE_ALIAS_GROUP_MEMBER,

    // Custom emoji management
    RbacActions.MANAGE_EMOJIS,

    // Reaction management
    RbacActions.CREATE_REACTION,
    RbacActions.DELETE_REACTION,

    // Replay capture permission
    RbacActions.CAPTURE_REPLAY,

    // Community moderation within own communities
    RbacActions.KICK_USER,
    RbacActions.TIMEOUT_USER,
    RbacActions.UNBAN_USER,
    RbacActions.PIN_MESSAGE,
    RbacActions.UNPIN_MESSAGE,
    RbacActions.DELETE_ANY_MESSAGE,
    RbacActions.VIEW_BAN_LIST,
    RbacActions.VIEW_MODERATION_LOGS,
    RbacActions.MUTE_PARTICIPANT,

    // Soundboard management
    RbacActions.CREATE_SOUNDBOARD_SOUND,
    RbacActions.DELETE_SOUNDBOARD_SOUND,
    RbacActions.READ_SOUNDBOARD_SOUND,
  ],
};

/**
 * Get actions for Community Creator role
 */
export function getCommunityCreatorActions(): RbacActions[] {
  return DEFAULT_COMMUNITY_CREATOR_ROLE.actions;
}

/**
 * User Manager role - manages users without full admin access
 * Good for support staff who need to help users but shouldn't change instance settings
 */
export const DEFAULT_USER_MANAGER_ROLE: DefaultRoleConfig = {
  name: 'User Manager',
  position: 30,
  actions: [
    // User management
    RbacActions.READ_USER,
    RbacActions.UPDATE_USER,
    RbacActions.BAN_USER,
    RbacActions.UNBAN_USER,
    RbacActions.MANAGE_USER_STORAGE,

    // Read-only instance access
    RbacActions.READ_INSTANCE_STATS,
  ],
};

/**
 * Invite Manager role - manages instance invites only
 * Good for trusted users who can invite others but shouldn't have admin access
 */
export const DEFAULT_INVITE_MANAGER_ROLE: DefaultRoleConfig = {
  name: 'Invite Manager',
  position: 40,
  actions: [
    // Instance invite management
    RbacActions.READ_INSTANCE_INVITE,
    RbacActions.CREATE_INSTANCE_INVITE,
    RbacActions.DELETE_INSTANCE_INVITE,
    RbacActions.UPDATE_INSTANCE_INVITE,
  ],
};

/**
 * Get all default instance-level role configurations
 */
export function getDefaultInstanceRoles(): DefaultRoleConfig[] {
  return [
    DEFAULT_INSTANCE_ADMIN_ROLE,
    DEFAULT_COMMUNITY_CREATOR_ROLE,
    DEFAULT_USER_MANAGER_ROLE,
    DEFAULT_INVITE_MANAGER_ROLE,
  ];
}

/**
 * Default admin role with all community permissions
 */
export const DEFAULT_ADMIN_ROLE: DefaultRoleConfig = {
  name: 'Community Admin',
  position: 10,
  actions: [
    // All CRUD operations for communities
    RbacActions.UPDATE_COMMUNITY,
    RbacActions.DELETE_COMMUNITY,
    RbacActions.READ_COMMUNITY,

    // Channel management
    RbacActions.CREATE_CHANNEL,
    RbacActions.UPDATE_CHANNEL,
    RbacActions.MANAGE_CHANNEL_PERMISSIONS,
    RbacActions.MANAGE_WEBHOOKS,
    RbacActions.DELETE_CHANNEL,
    RbacActions.READ_CHANNEL,

    // Voice channel permissions
    RbacActions.JOIN_CHANNEL,
    RbacActions.SPEAK,
    RbacActions.VIDEO,
    RbacActions.SCREEN_SHARE,

    // Member management
    RbacActions.CREATE_MEMBER,
    RbacActions.UPDATE_MEMBER,
    RbacActions.DELETE_MEMBER,
    RbacActions.READ_MEMBER,

    // Message management
    RbacActions.CREATE_MESSAGE,
    RbacActions.ATTACH_FILES,
    RbacActions.DELETE_MESSAGE,
    RbacActions.READ_MESSAGE,

    // Role management within community
    RbacActions.CREATE_ROLE,
    RbacActions.UPDATE_ROLE,
    RbacActions.DELETE_ROLE,
    RbacActions.READ_ROLE,

    // Invite management
    RbacActions.CREATE_INVITE,
    RbacActions.DELETE_INVITE,

    // Alias group management
    RbacActions.CREATE_ALIAS_GROUP,
    RbacActions.UPDATE_ALIAS_GROUP,
    RbacActions.DELETE_ALIAS_GROUP,
    RbacActions.READ_ALIAS_GROUP,
    RbacActions.CREATE_ALIAS_GROUP_MEMBER,
    RbacActions.DELETE_ALIAS_GROUP_MEMBER,
    RbacActions.READ_ALIAS_GROUP_MEMBER,
    RbacActions.UPDATE_ALIAS_GROUP_MEMBER,

    // Custom emoji management
    RbacActions.MANAGE_EMOJIS,

    // Reaction management
    RbacActions.CREATE_REACTION,
    RbacActions.DELETE_REACTION,

    // Replay capture permission
    RbacActions.CAPTURE_REPLAY,

    // Community moderation (full)
    RbacActions.KICK_USER,
    RbacActions.TIMEOUT_USER,
    RbacActions.UNBAN_USER,
    RbacActions.PIN_MESSAGE,
    RbacActions.UNPIN_MESSAGE,
    RbacActions.DELETE_ANY_MESSAGE,
    RbacActions.VIEW_BAN_LIST,
    RbacActions.VIEW_MODERATION_LOGS,
    RbacActions.MUTE_PARTICIPANT,

    // Soundboard management
    RbacActions.CREATE_SOUNDBOARD_SOUND,
    RbacActions.DELETE_SOUNDBOARD_SOUND,
    RbacActions.READ_SOUNDBOARD_SOUND,
  ],
};

/**
 * Default moderator role with limited permissions
 */
export const DEFAULT_MODERATOR_ROLE: DefaultRoleConfig = {
  name: 'Moderator',
  position: 20,
  actions: [
    // Read permissions
    RbacActions.READ_COMMUNITY,
    RbacActions.READ_CHANNEL,
    RbacActions.READ_MEMBER,
    RbacActions.READ_MESSAGE,
    RbacActions.READ_ROLE,

    // Message moderation
    RbacActions.CREATE_MESSAGE,
    RbacActions.ATTACH_FILES,
    RbacActions.DELETE_MESSAGE,

    // Basic channel management
    RbacActions.CREATE_CHANNEL,
    RbacActions.UPDATE_CHANNEL,
    RbacActions.MANAGE_CHANNEL_PERMISSIONS,
    RbacActions.MANAGE_WEBHOOKS,

    // Voice channel permissions
    RbacActions.JOIN_CHANNEL,
    RbacActions.SPEAK,
    RbacActions.VIDEO,
    RbacActions.SCREEN_SHARE,

    // Member management (limited)
    RbacActions.CREATE_MEMBER,
    RbacActions.UPDATE_MEMBER,

    // Reaction management
    RbacActions.CREATE_REACTION,
    RbacActions.DELETE_REACTION,

    // Alias group management (limited)
    RbacActions.READ_ALIAS_GROUP,
    RbacActions.READ_ALIAS_GROUP_MEMBER,

    // Replay capture permission
    RbacActions.CAPTURE_REPLAY,

    // Community moderation (limited - no unban, no logs)
    RbacActions.KICK_USER,
    RbacActions.TIMEOUT_USER,
    RbacActions.PIN_MESSAGE,
    RbacActions.UNPIN_MESSAGE,
    RbacActions.DELETE_ANY_MESSAGE,
    RbacActions.VIEW_BAN_LIST,
    RbacActions.MUTE_PARTICIPANT,

    // Soundboard (read to list, manage to add/remove)
    RbacActions.READ_SOUNDBOARD_SOUND,
    RbacActions.CREATE_SOUNDBOARD_SOUND,
    RbacActions.DELETE_SOUNDBOARD_SOUND,
  ],
};

/**
 * Default member role with basic permissions for regular users
 */
export const DEFAULT_MEMBER_ROLE: DefaultRoleConfig = {
  name: 'Member',
  position: 100,
  actions: [
    // Basic read permissions
    RbacActions.READ_COMMUNITY,
    RbacActions.READ_CHANNEL,
    RbacActions.READ_MEMBER,
    RbacActions.READ_MESSAGE,

    // Basic message permissions
    RbacActions.CREATE_MESSAGE,
    RbacActions.ATTACH_FILES,

    // Voice channel permissions
    RbacActions.JOIN_CHANNEL,
    RbacActions.SPEAK,
    RbacActions.VIDEO,
    RbacActions.SCREEN_SHARE,

    // Basic reaction permissions
    RbacActions.CREATE_REACTION,
    RbacActions.DELETE_REACTION,

    // Basic alias group reading
    RbacActions.READ_ALIAS_GROUP,
    RbacActions.READ_ALIAS_GROUP_MEMBER,

    // Replay capture permission
    RbacActions.CAPTURE_REPLAY,

    // Soundboard: members can list and play sounds (playing is client-side)
    RbacActions.READ_SOUNDBOARD_SOUND,
  ],
};

/**
 * Get all default roles for a community
 */
export function getDefaultCommunityRoles(): DefaultRoleConfig[] {
  return [DEFAULT_ADMIN_ROLE, DEFAULT_MODERATOR_ROLE, DEFAULT_MEMBER_ROLE];
}
