import { ServerEvents } from '@semaphore-chat/shared';
import type { ServerEventPayloads } from '@semaphore-chat/shared';
import type { SocketEventHandler } from './types';
import * as messageHandlers from './messageHandlers';
import * as presenceHandlers from './presenceHandlers';
import * as voiceHandlers from './voiceHandlers';
import * as communityHandlers from './communityHandlers';
import * as communityAssetHandlers from './communityAssetHandlers';
import * as moderationHandlers from './moderationHandlers';
import * as roleHandlers from './roleHandlers';
import * as notificationHandlers from './notificationHandlers';
import * as threadHandlers from './threadHandlers';
import * as friendHandlers from './friendHandlers';
import * as dmGroupHandlers from './dmGroupHandlers';

/**
 * Central registry mapping every handled ServerEvent to its cache handler(s).
 * Each event maps to an array of handlers, executed sequentially.
 *
 * Events not listed here are still re-emitted on the event bus — they just
 * don't have cache side effects.
 */
export const handlerRegistry: {
  [E in keyof ServerEventPayloads]?: SocketEventHandler<E>[];
} = {
  // Messages (channels + DMs share the same handler)
  [ServerEvents.NEW_MESSAGE]: [messageHandlers.handleNewMessage],
  [ServerEvents.NEW_DM]: [messageHandlers.handleNewMessage],
  [ServerEvents.UPDATE_MESSAGE]: [messageHandlers.handleUpdateMessage],
  [ServerEvents.DELETE_MESSAGE]: [messageHandlers.handleDeleteMessage],

  // Reactions
  [ServerEvents.REACTION_ADDED]: [messageHandlers.handleReactionAdded],
  [ServerEvents.REACTION_REMOVED]: [messageHandlers.handleReactionRemoved],

  // Pins
  [ServerEvents.MESSAGE_PINNED]: [messageHandlers.handleMessagePinned],
  [ServerEvents.MESSAGE_UNPINNED]: [messageHandlers.handleMessageUnpinned],

  // Thread reply count (updates parent message in channel/DM cache)
  [ServerEvents.THREAD_REPLY_COUNT_UPDATED]: [messageHandlers.handleThreadReplyCountUpdated],

  // Read receipts
  [ServerEvents.READ_RECEIPT_UPDATED]: [messageHandlers.handleReadReceiptUpdated],

  // Presence
  [ServerEvents.USER_ONLINE]: [presenceHandlers.handleUserOnline],
  [ServerEvents.USER_OFFLINE]: [presenceHandlers.handleUserOffline],

  // Voice
  [ServerEvents.VOICE_CHANNEL_USER_JOINED]: [voiceHandlers.handleVoiceUserJoined],
  [ServerEvents.VOICE_CHANNEL_USER_LEFT]: [voiceHandlers.handleVoiceUserLeft],
  [ServerEvents.VOICE_CHANNEL_USER_UPDATED]: [voiceHandlers.handleVoiceUserUpdated],

  // Community
  [ServerEvents.MEMBER_ADDED_TO_COMMUNITY]: [communityHandlers.handleMemberAddedToCommunity],

  // Friends (every friendship event has the same payload: ids only)
  [ServerEvents.FRIEND_REQUEST_SENT]: [friendHandlers.handleFriendshipChanged],
  [ServerEvents.FRIEND_REQUEST_ACCEPTED]: [friendHandlers.handleFriendshipChanged],
  [ServerEvents.FRIEND_REQUEST_DECLINED]: [friendHandlers.handleFriendshipChanged],
  [ServerEvents.FRIEND_REQUEST_CANCELLED]: [friendHandlers.handleFriendshipChanged],
  [ServerEvents.FRIEND_REMOVED]: [friendHandlers.handleFriendshipChanged],

  // DM groups
  [ServerEvents.DM_GROUP_CREATED]: [dmGroupHandlers.handleDmGroupCreated],
  [ServerEvents.DM_GROUP_MEMBER_ADDED]: [dmGroupHandlers.handleDmGroupMemberAdded],
  [ServerEvents.DM_GROUP_MEMBER_LEFT]: [dmGroupHandlers.handleDmGroupMemberLeft],

  // Notifications
  [ServerEvents.NEW_NOTIFICATION]: [notificationHandlers.handleNewNotification],
  [ServerEvents.NOTIFICATION_READ]: [notificationHandlers.handleNotificationRead],
  [ServerEvents.NOTIFICATIONS_READ]: [notificationHandlers.handleNotificationsRead],
  [ServerEvents.NOTIFICATION_DISMISSED]: [notificationHandlers.handleNotificationDismissed],

  // Threads (replies cache)
  [ServerEvents.NEW_THREAD_REPLY]: [threadHandlers.handleNewThreadReply],

  // DM Voice
  [ServerEvents.DM_VOICE_CALL_STARTED]: [voiceHandlers.handleDmVoiceCallStarted],
  [ServerEvents.DM_VOICE_USER_JOINED]: [voiceHandlers.handleDmVoiceUserJoined],
  [ServerEvents.DM_VOICE_USER_LEFT]: [voiceHandlers.handleDmVoiceUserLeft],

  // Moderation
  [ServerEvents.USER_BANNED]: [moderationHandlers.handleUserBanned],
  [ServerEvents.USER_UNBANNED]: [moderationHandlers.handleUserUnbanned],
  [ServerEvents.USER_KICKED]: [moderationHandlers.handleUserKicked],
  [ServerEvents.USER_TIMED_OUT]: [moderationHandlers.handleUserTimedOut],
  [ServerEvents.TIMEOUT_REMOVED]: [moderationHandlers.handleTimeoutRemoved],

  // Private channel membership
  [ServerEvents.PRIVATE_CHANNEL_ADDED]: [communityHandlers.handlePrivateChannelAdded],
  [ServerEvents.PRIVATE_CHANNEL_REMOVED]: [communityHandlers.handlePrivateChannelRemoved],

  // Community assets
  [ServerEvents.CUSTOM_EMOJI_CREATED]: [communityAssetHandlers.handleCustomEmojiCreated],
  [ServerEvents.CUSTOM_EMOJI_DELETED]: [communityAssetHandlers.handleCustomEmojiDeleted],
  [ServerEvents.SOUNDBOARD_SOUND_CREATED]: [communityAssetHandlers.handleSoundboardSoundCreated],
  [ServerEvents.SOUNDBOARD_SOUND_DELETED]: [communityAssetHandlers.handleSoundboardSoundDeleted],
  [ServerEvents.ALIAS_GROUP_CREATED]: [communityAssetHandlers.handleAliasGroupChanged],
  [ServerEvents.ALIAS_GROUP_UPDATED]: [communityAssetHandlers.handleAliasGroupChanged],
  [ServerEvents.ALIAS_GROUP_DELETED]: [communityAssetHandlers.handleAliasGroupChanged],
  [ServerEvents.ALIAS_GROUP_MEMBERS_UPDATED]: [communityAssetHandlers.handleAliasGroupChanged],
  [ServerEvents.WEBHOOK_CREATED]: [communityAssetHandlers.handleWebhookCreated],
  [ServerEvents.WEBHOOK_DELETED]: [communityAssetHandlers.handleWebhookDeleted],

  // Channel lifecycle & reorder
  [ServerEvents.CHANNELS_REORDERED]: [communityHandlers.handleChannelsReordered],
  [ServerEvents.CHANNEL_CREATED]: [communityHandlers.handleChannelCreated],
  [ServerEvents.CHANNEL_UPDATED]: [communityHandlers.handleChannelUpdated],
  [ServerEvents.CHANNEL_DELETED]: [communityHandlers.handleChannelDeleted],
  [ServerEvents.CHANNEL_PERMISSIONS_UPDATED]: [communityHandlers.handleChannelPermissionsUpdated],

  // Community lifecycle
  [ServerEvents.COMMUNITY_UPDATED]: [communityHandlers.handleCommunityUpdated],
  [ServerEvents.COMMUNITY_DELETED]: [communityHandlers.handleCommunityDeleted],

  // Roles
  [ServerEvents.ROLE_CREATED]: [roleHandlers.handleRoleCreated],
  [ServerEvents.ROLE_UPDATED]: [roleHandlers.handleRoleUpdated],
  [ServerEvents.ROLE_DELETED]: [roleHandlers.handleRoleDeleted],
  [ServerEvents.ROLE_ASSIGNED]: [roleHandlers.handleRoleAssigned],
  [ServerEvents.ROLE_UNASSIGNED]: [roleHandlers.handleRoleUnassigned],
  [ServerEvents.INSTANCE_ROLES_UPDATED]: [roleHandlers.handleInstanceRolesUpdated],

  // User profile
  [ServerEvents.USER_PROFILE_UPDATED]: [presenceHandlers.handleUserProfileUpdated],
};
