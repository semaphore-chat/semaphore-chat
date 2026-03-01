/**
 * WebSocket Event Payload Types
 *
 * Shared payload type definitions for all WebSocket events.
 */

import { Message, Reaction } from '../types/message.types';
import { Channel } from '../types/channel.types';
import { NewNotificationPayload, NotificationReadPayload } from '../types/notification.types';
import { ServerEvents } from '../events/server-events.enum';

// Re-export notification payloads for convenience
export type { NewNotificationPayload, NotificationReadPayload };

// =============================================================================
// Common Types
// =============================================================================

export interface UserPresenceInfo {
  userId: string;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface VoicePresenceUser {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  joinedAt: Date | string;
  isDeafened?: boolean;
  isServerMuted?: boolean;
}

// =============================================================================
// Acknowledgment & Error Payloads
// =============================================================================

export interface AckPayload {
  id: string;
  [key: string]: unknown;
}

export interface ErrorPayload {
  message: string;
  code?: string | number;
  [key: string]: unknown;
}

// =============================================================================
// Message Payloads
// =============================================================================

export interface NewMessagePayload {
  message: Message;
}

export interface UpdateMessagePayload {
  message: Message;
}

export interface DeleteMessagePayload {
  messageId: string;
  channelId?: string | null;
  directMessageGroupId?: string | null;
}

// =============================================================================
// Reaction Payloads
// =============================================================================

export interface ReactionAddedPayload {
  messageId: string;
  reaction: Reaction;
  channelId?: string | null;
  directMessageGroupId?: string | null;
}

export interface ReactionRemovedPayload {
  messageId: string;
  emoji: string;
  reactions: Reaction[];
  channelId?: string | null;
  directMessageGroupId?: string | null;
}

// =============================================================================
// Read Receipt Payloads
// =============================================================================

export interface ReadReceiptUpdatedPayload {
  channelId?: string | null;
  directMessageGroupId?: string | null;
  lastReadMessageId: string;
  lastReadAt: string;
  /** Present when broadcast to DM room (not on user-room self-sync) */
  userId?: string;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

// =============================================================================
// Presence & Typing Payloads
// =============================================================================

export type UserOnlinePayload = UserPresenceInfo;

export type UserOfflinePayload = UserPresenceInfo;

export interface UserTypingPayload {
  userId: string;
  channelId?: string;
  directMessageGroupId?: string;
  isTyping: boolean;
}

// =============================================================================
// Voice Channel Payloads
// =============================================================================

export interface VoiceChannelUserJoinedPayload {
  channelId: string;
  user: VoicePresenceUser;
}

export interface VoiceChannelUserLeftPayload {
  channelId: string;
  userId: string;
  user: VoicePresenceUser;
}

export interface VoiceChannelUserUpdatedPayload {
  channelId: string;
  userId: string;
  user: VoicePresenceUser;
}

// =============================================================================
// DM Voice Call Payloads
// =============================================================================

export interface DmVoiceCallStartedPayload {
  dmGroupId: string;
  startedBy: string;
  starter: {
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  };
}

export interface DmVoiceUserJoinedPayload {
  dmGroupId: string;
  user: VoicePresenceUser;
}

export interface DmVoiceUserLeftPayload {
  dmGroupId: string;
  userId: string;
  user: VoicePresenceUser;
}

export interface DmVoiceUserUpdatedPayload {
  dmGroupId: string;
  userId: string;
  user: VoicePresenceUser;
}

// =============================================================================
// Replay Buffer (Screen Recording) Payloads
// =============================================================================

export interface ReplayBufferStoppedPayload {
  sessionId: string;
  egressId: string;
  channelId: string;
}

export interface ReplayBufferFailedPayload {
  sessionId: string;
  egressId: string;
  channelId: string;
  error: string;
}

// =============================================================================
// Channel Management Payloads
// =============================================================================

export interface ChannelsReorderedPayload {
  communityId: string;
  channels: Channel[];
}

// =============================================================================
// Moderation Payloads
// =============================================================================

export interface UserBannedPayload {
  communityId: string;
  userId: string;
  moderatorId: string;
  reason?: string;
  expiresAt?: string;
}

export interface UserKickedPayload {
  communityId: string;
  userId: string;
  moderatorId: string;
  reason?: string;
}

export interface UserTimedOutPayload {
  communityId: string;
  userId: string;
  moderatorId: string;
  reason?: string;
  durationSeconds: number;
  expiresAt: string;
}

export interface TimeoutRemovedPayload {
  communityId: string;
  userId: string;
  moderatorId: string;
  reason?: string;
}

export interface MessagePinnedPayload {
  messageId: string;
  channelId: string;
  pinnedBy: string;
  pinnedAt: string;
}

export interface MessageUnpinnedPayload {
  messageId: string;
  channelId: string;
  unpinnedBy: string;
}

export interface NewThreadReplyPayload {
  reply: Message;
  parentMessageId: string;
}

export interface UpdateThreadReplyPayload {
  reply: Message;
  parentMessageId: string;
}

export interface DeleteThreadReplyPayload {
  replyId: string;
  parentMessageId: string;
}

export interface ThreadReplyCountUpdatedPayload {
  parentMessageId: string;
  replyCount: number;
  lastReplyAt: string | null;
  channelId?: string | null;
  directMessageGroupId?: string | null;
}

// =============================================================================
// Community Membership Payloads
// =============================================================================

export interface MemberAddedToCommunityPayload {
  communityId: string;
  userId: string;
}

// =============================================================================
// Channel Lifecycle Payloads
// =============================================================================

export interface ChannelCreatedPayload {
  communityId: string;
  channel: Channel;
}

export interface ChannelUpdatedPayload {
  communityId: string;
  channel: Channel;
}

export interface ChannelDeletedPayload {
  communityId: string;
  channelId: string;
}

// =============================================================================
// Community Lifecycle Payloads
// =============================================================================

export interface CommunityUpdatedPayload {
  communityId: string;
  name?: string;
  description?: string | null;
  avatar?: string | null;
  banner?: string | null;
}

export interface CommunityDeletedPayload {
  communityId: string;
}

// =============================================================================
// Role Management Payloads
// =============================================================================

export interface RoleCreatedPayload {
  communityId: string;
  roleId: string;
  roleName: string;
}

export interface RoleUpdatedPayload {
  communityId: string;
  roleId: string;
  roleName: string;
}

export interface RoleDeletedPayload {
  communityId: string;
  roleId: string;
}

export interface RoleAssignedPayload {
  communityId: string;
  userId: string;
  roleId: string;
  roleName: string;
}

export interface RoleUnassignedPayload {
  communityId: string;
  userId: string;
  roleId: string;
}

// =============================================================================
// User Profile Payloads
// =============================================================================

export interface UserProfileUpdatedPayload {
  userId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  bio?: string | null;
}

// =============================================================================
// Egress Payloads
// =============================================================================

export interface EgressSegmentsReadyPayload {
  sessionId: string;
  channelId: string;
}

// =============================================================================
// Server Events Payload Map
// =============================================================================

export type ServerEventPayloads = {
  // Messaging: Channels
  [ServerEvents.NEW_MESSAGE]: NewMessagePayload;
  [ServerEvents.UPDATE_MESSAGE]: UpdateMessagePayload;
  [ServerEvents.DELETE_MESSAGE]: DeleteMessagePayload;

  // Message Reactions
  [ServerEvents.REACTION_ADDED]: ReactionAddedPayload;
  [ServerEvents.REACTION_REMOVED]: ReactionRemovedPayload;

  // Read Receipts
  [ServerEvents.READ_RECEIPT_UPDATED]: ReadReceiptUpdatedPayload;

  // Messaging: Direct Messages
  [ServerEvents.NEW_DM]: NewMessagePayload;

  // Mentions & Notifications
  [ServerEvents.NEW_NOTIFICATION]: NewNotificationPayload;
  [ServerEvents.NOTIFICATION_READ]: NotificationReadPayload;

  // Presence & Typing
  [ServerEvents.USER_ONLINE]: UserOnlinePayload;
  [ServerEvents.USER_OFFLINE]: UserOfflinePayload;
  [ServerEvents.USER_TYPING]: UserTypingPayload;

  // Voice Channels
  [ServerEvents.VOICE_CHANNEL_USER_JOINED]: VoiceChannelUserJoinedPayload;
  [ServerEvents.VOICE_CHANNEL_USER_LEFT]: VoiceChannelUserLeftPayload;
  [ServerEvents.VOICE_CHANNEL_USER_UPDATED]: VoiceChannelUserUpdatedPayload;

  // DM Voice Calls
  [ServerEvents.DM_VOICE_CALL_STARTED]: DmVoiceCallStartedPayload;
  [ServerEvents.DM_VOICE_USER_JOINED]: DmVoiceUserJoinedPayload;
  [ServerEvents.DM_VOICE_USER_LEFT]: DmVoiceUserLeftPayload;
  [ServerEvents.DM_VOICE_USER_UPDATED]: DmVoiceUserUpdatedPayload;

  // Replay Buffer (Screen Recording)
  [ServerEvents.REPLAY_BUFFER_STOPPED]: ReplayBufferStoppedPayload;
  [ServerEvents.REPLAY_BUFFER_FAILED]: ReplayBufferFailedPayload;

  // Channel Management
  [ServerEvents.CHANNELS_REORDERED]: ChannelsReorderedPayload;

  // Moderation Events
  [ServerEvents.USER_BANNED]: UserBannedPayload;
  [ServerEvents.USER_KICKED]: UserKickedPayload;
  [ServerEvents.USER_TIMED_OUT]: UserTimedOutPayload;
  [ServerEvents.TIMEOUT_REMOVED]: TimeoutRemovedPayload;
  [ServerEvents.MESSAGE_PINNED]: MessagePinnedPayload;
  [ServerEvents.MESSAGE_UNPINNED]: MessageUnpinnedPayload;
  [ServerEvents.NEW_THREAD_REPLY]: NewThreadReplyPayload;
  [ServerEvents.UPDATE_THREAD_REPLY]: UpdateThreadReplyPayload;
  [ServerEvents.DELETE_THREAD_REPLY]: DeleteThreadReplyPayload;
  [ServerEvents.THREAD_REPLY_COUNT_UPDATED]: ThreadReplyCountUpdatedPayload;

  // Community Membership
  [ServerEvents.MEMBER_ADDED_TO_COMMUNITY]: MemberAddedToCommunityPayload;

  // Channel Lifecycle
  [ServerEvents.CHANNEL_CREATED]: ChannelCreatedPayload;
  [ServerEvents.CHANNEL_UPDATED]: ChannelUpdatedPayload;
  [ServerEvents.CHANNEL_DELETED]: ChannelDeletedPayload;

  // Community Lifecycle
  [ServerEvents.COMMUNITY_UPDATED]: CommunityUpdatedPayload;
  [ServerEvents.COMMUNITY_DELETED]: CommunityDeletedPayload;

  // Role Management
  [ServerEvents.ROLE_CREATED]: RoleCreatedPayload;
  [ServerEvents.ROLE_UPDATED]: RoleUpdatedPayload;
  [ServerEvents.ROLE_DELETED]: RoleDeletedPayload;
  [ServerEvents.ROLE_ASSIGNED]: RoleAssignedPayload;
  [ServerEvents.ROLE_UNASSIGNED]: RoleUnassignedPayload;

  // User Profile
  [ServerEvents.USER_PROFILE_UPDATED]: UserProfileUpdatedPayload;

  // Egress
  [ServerEvents.EGRESS_SEGMENTS_READY]: EgressSegmentsReadyPayload;

  // Acknowledgments & Errors
  [ServerEvents.ACK]: AckPayload;
  [ServerEvents.ERROR]: ErrorPayload;
};

export type ServerEventHandler<E extends keyof ServerEventPayloads> = (
  payload: ServerEventPayloads[E]
) => void;

export type PayloadOf<E extends keyof ServerEventPayloads> = ServerEventPayloads[E];
