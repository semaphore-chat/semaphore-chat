/**
 * WebSocket Event Payload Types
 *
 * Shared payload type definitions for all WebSocket events.
 */

import type {
  ChannelCreatedPayloadDto,
  ChannelDeletedPayloadDto,
  ChannelPermissionsUpdatedPayloadDto,
  ChannelUpdatedPayloadDto,
  ChannelsReorderedPayloadDto,
  CommunityDeletedPayloadDto,
  CommunityUpdatedPayloadDto,
  DeleteMessagePayloadDto,
  DmVoiceCallStartedPayloadDto,
  DmVoiceUserJoinedPayloadDto,
  DmVoiceUserLeftPayloadDto,
  EgressSegmentsReadyPayloadDto,
  MemberAddedToCommunityPayloadDto,
  MessagePinnedPayloadDto,
  MessageUnpinnedPayloadDto,
  NewMessagePayloadDto,
  NewThreadReplyPayloadDto,
  ReactionAddedPayloadDto,
  ReactionRemovedPayloadDto,
  ReadReceiptUpdatedPayloadDto,
  ReauthenticateResultDto,
  ReplayBufferFailedPayloadDto,
  ReplayBufferStoppedPayloadDto,
  RoleAssignedPayloadDto,
  RoleCreatedPayloadDto,
  RoleDeletedPayloadDto,
  RoleUnassignedPayloadDto,
  RoleUpdatedPayloadDto,
  SessionTerminatedPayloadDto,
  ThreadReplyCountUpdatedPayloadDto,
  TimeoutRemovedPayloadDto,
  TokenExpiringPayloadDto,
  UpdateMessagePayloadDto,
  UserBannedPayloadDto,
  UserKickedPayloadDto,
  UserPresencePayloadDto,
  UserProfileUpdatedPayloadDto,
  UserTimedOutPayloadDto,
  UserTypingPayloadDto,
  VoiceChannelUserJoinedPayloadDto,
  VoiceChannelUserLeftPayloadDto,
  VoiceChannelUserUpdatedPayloadDto,
  VoicePresenceUserDto,
} from '../generated';
import type { NewNotificationPayload, NotificationReadPayload } from '../types/notification.types';
import { ServerEvents } from '../events/server-events.enum';

// Re-export notification payloads for convenience
export type { NewNotificationPayload, NotificationReadPayload };

// =============================================================================
// Common Types
// =============================================================================

export type UserPresenceInfo = UserPresencePayloadDto;

export type VoicePresenceUser = VoicePresenceUserDto;

// =============================================================================
// Session Lifecycle Payloads
// =============================================================================

export type { SessionTerminatedReason } from '../generated';

export interface DesktopSignInPayload {
  /** Where the app signed in from, as the server saw it. */
  ipAddress: string | null;
  signedInAt: string;
}

export type SessionTerminatedPayload = SessionTerminatedPayloadDto;

export type TokenExpiringPayload = TokenExpiringPayloadDto;

export type ReauthenticateResult = ReauthenticateResultDto;

// =============================================================================
// Acknowledgment & Error Payloads
// =============================================================================

// =============================================================================
// Message Payloads
// =============================================================================

export type NewMessagePayload = NewMessagePayloadDto;

export type UpdateMessagePayload = UpdateMessagePayloadDto;

export type DeleteMessagePayload = DeleteMessagePayloadDto;

// =============================================================================
// Reaction Payloads
// =============================================================================

export type ReactionAddedPayload = ReactionAddedPayloadDto;

export type ReactionRemovedPayload = ReactionRemovedPayloadDto;

// =============================================================================
// Read Receipt Payloads
// =============================================================================

export type ReadReceiptUpdatedPayload = ReadReceiptUpdatedPayloadDto;

// =============================================================================
// Presence & Typing Payloads
// =============================================================================

export type UserOnlinePayload = UserPresenceInfo;

export type UserOfflinePayload = UserPresenceInfo;

export type UserTypingPayload = UserTypingPayloadDto;

// =============================================================================
// Voice Channel Payloads
// =============================================================================

export type VoiceChannelUserJoinedPayload = VoiceChannelUserJoinedPayloadDto;

export type VoiceChannelUserLeftPayload = VoiceChannelUserLeftPayloadDto;

export type VoiceChannelUserUpdatedPayload = VoiceChannelUserUpdatedPayloadDto;

// =============================================================================
// DM Voice Call Payloads
// =============================================================================

export type DmVoiceCallStartedPayload = DmVoiceCallStartedPayloadDto;

export type DmVoiceUserJoinedPayload = DmVoiceUserJoinedPayloadDto;

export type DmVoiceUserLeftPayload = DmVoiceUserLeftPayloadDto;


// =============================================================================
// Replay Buffer (Screen Recording) Payloads
// =============================================================================

export type ReplayBufferStoppedPayload = ReplayBufferStoppedPayloadDto;

export type ReplayBufferFailedPayload = ReplayBufferFailedPayloadDto;

// =============================================================================
// Channel Management Payloads
// =============================================================================

export type ChannelsReorderedPayload = ChannelsReorderedPayloadDto;

// =============================================================================
// Moderation Payloads
// =============================================================================

export type UserBannedPayload = UserBannedPayloadDto;

export type UserKickedPayload = UserKickedPayloadDto;

export type UserTimedOutPayload = UserTimedOutPayloadDto;

export type TimeoutRemovedPayload = TimeoutRemovedPayloadDto;

export type MessagePinnedPayload = MessagePinnedPayloadDto;

export type MessageUnpinnedPayload = MessageUnpinnedPayloadDto;

export type NewThreadReplyPayload = NewThreadReplyPayloadDto;



export type ThreadReplyCountUpdatedPayload = ThreadReplyCountUpdatedPayloadDto;

// =============================================================================
// Community Membership Payloads
// =============================================================================

export type MemberAddedToCommunityPayload = MemberAddedToCommunityPayloadDto;

// =============================================================================
// Channel Lifecycle Payloads
// =============================================================================

export type ChannelCreatedPayload = ChannelCreatedPayloadDto;

export type ChannelUpdatedPayload = ChannelUpdatedPayloadDto;

export type ChannelPermissionsUpdatedPayload = ChannelPermissionsUpdatedPayloadDto;

export type ChannelDeletedPayload = ChannelDeletedPayloadDto;

// =============================================================================
// Community Lifecycle Payloads
// =============================================================================

export type CommunityUpdatedPayload = CommunityUpdatedPayloadDto;

export type CommunityDeletedPayload = CommunityDeletedPayloadDto;

// =============================================================================
// Role Management Payloads
// =============================================================================

export type RoleCreatedPayload = RoleCreatedPayloadDto;

export type RoleUpdatedPayload = RoleUpdatedPayloadDto;

export type RoleDeletedPayload = RoleDeletedPayloadDto;

export type RoleAssignedPayload = RoleAssignedPayloadDto;

export type RoleUnassignedPayload = RoleUnassignedPayloadDto;

// =============================================================================
// User Profile Payloads
// =============================================================================

export type UserProfileUpdatedPayload = UserProfileUpdatedPayloadDto;

// =============================================================================
// Egress Payloads
// =============================================================================

export type EgressSegmentsReadyPayload = EgressSegmentsReadyPayloadDto;

// =============================================================================
// Server Events Payload Map
// =============================================================================

export type ServerEventPayloads = {
  // Session lifecycle
  [ServerEvents.TOKEN_EXPIRING]: TokenExpiringPayload;
  [ServerEvents.SESSION_TERMINATED]: SessionTerminatedPayload;
  [ServerEvents.DESKTOP_SIGN_IN]: DesktopSignInPayload;

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
  [ServerEvents.THREAD_REPLY_COUNT_UPDATED]: ThreadReplyCountUpdatedPayload;

  // Community Membership
  [ServerEvents.MEMBER_ADDED_TO_COMMUNITY]: MemberAddedToCommunityPayload;

  // Channel Lifecycle
  [ServerEvents.CHANNEL_CREATED]: ChannelCreatedPayload;
  [ServerEvents.CHANNEL_UPDATED]: ChannelUpdatedPayload;
  [ServerEvents.CHANNEL_DELETED]: ChannelDeletedPayload;
  [ServerEvents.CHANNEL_PERMISSIONS_UPDATED]: ChannelPermissionsUpdatedPayload;

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
};

export type ServerEventHandler<E extends keyof ServerEventPayloads> = (
  payload: ServerEventPayloads[E]
) => void;

export type PayloadOf<E extends keyof ServerEventPayloads> = ServerEventPayloads[E];
