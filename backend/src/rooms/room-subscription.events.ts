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
  /** A timeout was applied or removed: resync voice publish permissions. */
  MODERATION_TIMEOUT_CHANGED = 'moderation.timeout-changed',
  /** A timeout ran out by itself: tell clients it's gone. */
  MODERATION_TIMEOUT_EXPIRED = 'moderation.timeout-expired',
  CHANNEL_CREATED = 'channel.created',
  CHANNEL_DELETED = 'channel.deleted',
  /** Who can see a channel may have changed (privacy toggle, overwrites). */
  CHANNEL_VISIBILITY_CHANGED = 'channel.visibility-changed',
  CHANNEL_MEMBERSHIP_CREATED = 'channel-membership.created',
  CHANNEL_MEMBERSHIP_REMOVED = 'channel-membership.removed',
  DM_GROUP_CREATED = 'dm-group.created',
  DM_GROUP_MEMBER_ADDED = 'dm-group.member-added',
  DM_GROUP_MEMBER_LEFT = 'dm-group.member-left',
  FRIEND_REQUEST_SENT = 'friendship.request-sent',
  FRIEND_REQUEST_ACCEPTED = 'friendship.request-accepted',
  FRIEND_REQUEST_DECLINED = 'friendship.request-declined',
  FRIEND_REQUEST_CANCELLED = 'friendship.request-cancelled',
  FRIEND_REMOVED = 'friendship.removed',
  ALIAS_GROUP_CREATED = 'alias-group.created',
  ALIAS_GROUP_UPDATED = 'alias-group.updated',
  ALIAS_GROUP_MEMBER_ADDED = 'alias-group.member-added',
  ALIAS_GROUP_MEMBER_REMOVED = 'alias-group.member-removed',
  ALIAS_GROUP_DELETED = 'alias-group.deleted',
  ALIAS_GROUP_MEMBERS_UPDATED = 'alias-group.members-updated',
  CUSTOM_EMOJI_CREATED = 'custom-emoji.created',
  CUSTOM_EMOJI_DELETED = 'custom-emoji.deleted',
  SOUNDBOARD_SOUND_CREATED = 'soundboard-sound.created',
  SOUNDBOARD_SOUND_DELETED = 'soundboard-sound.deleted',
  WEBHOOK_CREATED = 'webhook.created',
  WEBHOOK_DELETED = 'webhook.deleted',
  COMMUNITY_UPDATED = 'community.updated',
  COMMUNITY_DELETED = 'community.deleted',
  ROLE_CREATED = 'role.created',
  ROLE_UPDATED = 'role.updated',
  ROLE_DELETED = 'role.deleted',
  ROLE_ASSIGNED = 'role.assigned',
  ROLE_UNASSIGNED = 'role.unassigned',
  /** One of a user's own instance roles changed (assigned, removed, edited). */
  INSTANCE_ROLES_UPDATED = 'instance-roles.updated',
  USER_PROFILE_UPDATED = 'user.profile-updated',
  AUTH_SESSIONS_REVOKED = 'auth.sessions-revoked',
  AUTH_USER_SESSIONS_ENDED = 'auth.user-sessions-ended',
  /** A desktop app signed in through a browser approval. */
  AUTH_DESKTOP_SIGN_IN = 'auth.desktop-sign-in',
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
export interface AuthDesktopSignInEvent {
  userId: string;
  ipAddress: string | null;
}

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
}

export interface ModerationTimeoutChangedEvent {
  userId: string;
  communityId: string;
}

export interface ModerationTimeoutExpiredEvent {
  userId: string;
  communityId: string;
  /** The moderator who set the timeout, for the client payload. */
  moderatorId: string;
}

export interface ChannelVisibilityChangedEvent {
  channelId: string;
  communityId: string;
}

export interface ChannelDeletedEvent {
  channelId: string;
}

export interface ChannelMembershipCreatedEvent {
  userId: string;
  channelId: string;
  communityId: string;
}

export interface ChannelMembershipRemovedEvent {
  userId: string;
  channelId: string;
  communityId: string;
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

/**
 * Any change to a friendship: the actors differ per event (the sender for a
 * request, the receiver for accept/decline, either for a removal), so the
 * handler derives the audience from `actorId` and the event.
 */
export interface FriendshipChangedEvent {
  friendshipId: string;
  userAId: string;
  userBId: string;
  /** Who made the change: never notified as "the other person". */
  actorId: string;
}

export interface AliasGroupCreatedEvent {
  aliasGroupId: string;
  memberIds: string[];
  communityId: string;
}

export interface AliasGroupUpdatedEvent {
  aliasGroupId: string;
  communityId: string;
}

export interface AliasGroupMemberAddedEvent {
  aliasGroupId: string;
  userId: string;
  communityId: string;
}

export interface AliasGroupMemberRemovedEvent {
  aliasGroupId: string;
  userId: string;
  communityId: string;
}

export interface AliasGroupDeletedEvent {
  aliasGroupId: string;
  memberIds: string[];
  communityId: string;
}

export interface AliasGroupMembersUpdatedEvent {
  aliasGroupId: string;
  addedUserIds: string[];
  removedUserIds: string[];
  communityId: string;
}

export interface CustomEmojiChangedEvent {
  communityId: string;
  emojiId: string;
}

export interface SoundboardSoundChangedEvent {
  communityId: string;
  soundId: string;
}

export interface WebhookChangedEvent {
  communityId: string;
  channelId: string;
  webhookId: string;
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

export interface InstanceRolesUpdatedEvent {
  userId: string;
  roleId: string;
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
