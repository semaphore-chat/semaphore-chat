import type { SessionTerminatedReason } from '@semaphore-chat/shared';

/**
 * Domain event types for room subscription management.
 *
 * Services emit these events; the centralized RoomSubscriptionHandler
 * listens and manages WebSocket room joins/leaves accordingly.
 */

// =============================================================================
// Event Name Constants
// =============================================================================

export enum RoomEvents {
  MEMBERSHIP_CREATED = 'membership.created',
  MEMBERSHIP_REMOVED = 'membership.removed',
  MODERATION_USER_BANNED = 'moderation.user-banned',
  MODERATION_USER_KICKED = 'moderation.user-kicked',
  CHANNEL_CREATED = 'channel.created',
  CHANNEL_DELETED = 'channel.deleted',
  CHANNEL_MEMBERSHIP_CREATED = 'channel-membership.created',
  CHANNEL_MEMBERSHIP_REMOVED = 'channel-membership.removed',
  DM_GROUP_CREATED = 'dm-group.created',
  DM_GROUP_MEMBER_ADDED = 'dm-group.member-added',
  DM_GROUP_MEMBER_LEFT = 'dm-group.member-left',
  ALIAS_GROUP_CREATED = 'alias-group.created',
  ALIAS_GROUP_MEMBER_ADDED = 'alias-group.member-added',
  ALIAS_GROUP_MEMBER_REMOVED = 'alias-group.member-removed',
  ALIAS_GROUP_DELETED = 'alias-group.deleted',
  ALIAS_GROUP_MEMBERS_UPDATED = 'alias-group.members-updated',
  COMMUNITY_UPDATED = 'community.updated',
  COMMUNITY_DELETED = 'community.deleted',
  ROLE_CREATED = 'role.created',
  ROLE_UPDATED = 'role.updated',
  ROLE_DELETED = 'role.deleted',
  ROLE_ASSIGNED = 'role.assigned',
  ROLE_UNASSIGNED = 'role.unassigned',
  USER_PROFILE_UPDATED = 'user.profile-updated',
  AUTH_SESSIONS_REVOKED = 'auth.sessions-revoked',
  AUTH_USER_SESSIONS_ENDED = 'auth.user-sessions-ended',
}

// =============================================================================
// Event Payload Interfaces
// =============================================================================

/**
 * Some of a user's sessions were revoked (logout, "revoke session"): end the
 * sockets authenticated with them.
 */
export interface AuthSessionsRevokedEvent {
  userId: string;
  /** Session ids (refresh token family ids, the access token `sid`). */
  sessionIds: string[];
  /** Individual access token ids (`jti`), for tokens without a session id. */
  tokenIds: string[];
  reason: SessionTerminatedReason;
}

/**
 * Every session of a user ended (password reset, instance ban, account
 * deletion): end all of the user's sockets.
 */
export interface AuthUserSessionsEndedEvent {
  userId: string;
  reason: SessionTerminatedReason;
}

export interface MembershipCreatedEvent {
  userId: string;
  communityId: string;
}

export interface MembershipRemovedEvent {
  userId: string;
  communityId: string;
}

export interface ModerationUserBannedEvent {
  userId: string;
  communityId: string;
}

export interface ModerationUserKickedEvent {
  userId: string;
  communityId: string;
}

export interface ChannelCreatedEvent {
  channelId: string;
  communityId: string;
  isPrivate: boolean;
}

export interface ChannelDeletedEvent {
  channelId: string;
}

export interface ChannelMembershipCreatedEvent {
  userId: string;
  channelId: string;
}

export interface ChannelMembershipRemovedEvent {
  userId: string;
  channelId: string;
}

export interface DmGroupCreatedEvent {
  groupId: string;
  memberIds: string[];
}

export interface DmGroupMemberAddedEvent {
  groupId: string;
  userIds: string[];
}

export interface DmGroupMemberLeftEvent {
  groupId: string;
  userId: string;
}

export interface AliasGroupCreatedEvent {
  aliasGroupId: string;
  memberIds: string[];
}

export interface AliasGroupMemberAddedEvent {
  aliasGroupId: string;
  userId: string;
}

export interface AliasGroupMemberRemovedEvent {
  aliasGroupId: string;
  userId: string;
}

export interface AliasGroupDeletedEvent {
  aliasGroupId: string;
  memberIds: string[];
}

export interface AliasGroupMembersUpdatedEvent {
  aliasGroupId: string;
  addedUserIds: string[];
  removedUserIds: string[];
}

export interface CommunityUpdatedEvent {
  communityId: string;
  name: string;
  description: string | null;
  avatar: string | null;
  banner: string | null;
}

export interface CommunityDeletedEvent {
  communityId: string;
}

export interface RoleCreatedEvent {
  communityId: string;
  roleId: string;
  roleName: string;
}

export interface RoleUpdatedEvent {
  communityId: string;
  roleId: string;
  roleName: string;
}

export interface RoleDeletedEvent {
  communityId: string;
  roleId: string;
}

export interface RoleAssignedEvent {
  communityId: string;
  userId: string;
  roleId: string;
  roleName: string;
}

export interface RoleUnassignedEvent {
  communityId: string;
  userId: string;
  roleId: string;
}

export interface UserProfileUpdatedEvent {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
}
