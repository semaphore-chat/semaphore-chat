/**
 * Events emitted by the server and handled by the client.
 */
export enum ServerEvents {
  // Session lifecycle
  /** The socket's access token expires soon: refresh it and REAUTHENTICATE. */
  TOKEN_EXPIRING = 'tokenExpiring',
  /** Sent right before the server disconnects the socket, with the reason. */
  SESSION_TERMINATED = 'sessionTerminated',
  /** A desktop app was signed in to this account through a browser approval. */
  DESKTOP_SIGN_IN = 'desktopSignIn',

  // Messaging: Channels
  NEW_MESSAGE = 'newMessage',
  UPDATE_MESSAGE = 'updateMessage',
  DELETE_MESSAGE = 'deleteMessage',

  // Message Reactions
  REACTION_ADDED = 'reactionAdded',
  REACTION_REMOVED = 'reactionRemoved',

  // Read Receipts
  READ_RECEIPT_UPDATED = 'readReceiptUpdated',

  // Messaging: Direct Messages
  NEW_DM = 'newDirectMessage',

  // Mentions & Notifications
  NEW_NOTIFICATION = 'newNotification',
  NOTIFICATION_READ = 'notificationRead',

  // Presence & Typing
  USER_ONLINE = 'userOnline',
  USER_OFFLINE = 'userOffline',
  USER_TYPING = 'userTyping',

  // Voice Channels
  VOICE_CHANNEL_USER_JOINED = 'voiceChannelUserJoined',
  VOICE_CHANNEL_USER_LEFT = 'voiceChannelUserLeft',
  VOICE_CHANNEL_USER_UPDATED = 'voiceChannelUserUpdated',

  // DM Voice Calls
  DM_VOICE_CALL_STARTED = 'dmVoiceCallStarted',
  DM_VOICE_USER_JOINED = 'dmVoiceUserJoined',
  DM_VOICE_USER_LEFT = 'dmVoiceUserLeft',
  DM_VOICE_CALL_DECLINED = 'dmVoiceCallDeclined',
  DM_VOICE_CALL_ENDED = 'dmVoiceCallEnded',

  // Replay Buffer (Screen Recording)
  REPLAY_BUFFER_STOPPED = 'replayBufferStopped',
  REPLAY_BUFFER_FAILED = 'replayBufferFailed',

  // Channel Management
  CHANNELS_REORDERED = 'channelsReordered',

  // Moderation Events
  USER_BANNED = 'userBanned',
  /** A ban was lifted: refetch the ban list and the moderation log. */
  USER_UNBANNED = 'userUnbanned',
  USER_KICKED = 'userKicked',
  USER_TIMED_OUT = 'userTimedOut',
  TIMEOUT_REMOVED = 'timeoutRemoved',
  MESSAGE_PINNED = 'messagePinned',
  MESSAGE_UNPINNED = 'messageUnpinned',

  // Thread Events
  NEW_THREAD_REPLY = 'newThreadReply',
  THREAD_REPLY_COUNT_UPDATED = 'threadReplyCountUpdated',

  // Community Membership
  MEMBER_ADDED_TO_COMMUNITY = 'memberAddedToCommunity',

  // Channel Lifecycle
  CHANNEL_CREATED = 'channelCreated',
  CHANNEL_UPDATED = 'channelUpdated',
  CHANNEL_DELETED = 'channelDeleted',
  /** A channel's permission overwrites changed: refetch channel permissions. */
  CHANNEL_PERMISSIONS_UPDATED = 'channelPermissionsUpdated',

  // Community Lifecycle
  COMMUNITY_UPDATED = 'communityUpdated',
  COMMUNITY_DELETED = 'communityDeleted',

  // Role Management
  ROLE_CREATED = 'roleCreated',
  ROLE_UPDATED = 'roleUpdated',
  ROLE_DELETED = 'roleDeleted',
  ROLE_ASSIGNED = 'roleAssigned',
  ROLE_UNASSIGNED = 'roleUnassigned',

  // Private Channel Membership
  /** The user was added to a private channel: refetch their channel list. */
  PRIVATE_CHANNEL_ADDED = 'privateChannelAdded',
  /** The user was removed from a private channel. */
  PRIVATE_CHANNEL_REMOVED = 'privateChannelRemoved',

  // Community Assets
  CUSTOM_EMOJI_CREATED = 'customEmojiCreated',
  CUSTOM_EMOJI_DELETED = 'customEmojiDeleted',
  SOUNDBOARD_SOUND_CREATED = 'soundboardSoundCreated',
  SOUNDBOARD_SOUND_DELETED = 'soundboardSoundDeleted',
  ALIAS_GROUP_CREATED = 'aliasGroupCreated',
  ALIAS_GROUP_UPDATED = 'aliasGroupUpdated',
  ALIAS_GROUP_DELETED = 'aliasGroupDeleted',
  /** An alias group's members were added, removed or replaced. */
  ALIAS_GROUP_MEMBERS_UPDATED = 'aliasGroupMembersUpdated',
  WEBHOOK_CREATED = 'webhookCreated',
  WEBHOOK_DELETED = 'webhookDeleted',

  // User Profile
  USER_PROFILE_UPDATED = 'userProfileUpdated',

  // Egress
  EGRESS_SEGMENTS_READY = 'egressSegmentsReady',}
