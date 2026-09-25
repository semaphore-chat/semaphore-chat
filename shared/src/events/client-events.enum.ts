/**
 * Events emitted by the client and handled by the server.
 */
export enum ClientEvents {
  // Connection & Room Management
  SUBSCRIBE_ALL = 'subscribeAll',
  PRESENCE_ONLINE = 'presenceOnline',
  /** Swap the socket's access token for a fresh one (see TOKEN_EXPIRING). */
  REAUTHENTICATE = 'reauthenticate',

  // Messaging: Channels
  SEND_MESSAGE = 'sendMessage',

  // Message Reactions
  ADD_REACTION = 'addReaction',
  REMOVE_REACTION = 'removeReaction',

  // Read Receipts
  MARK_AS_READ = 'markAsRead',

  // Messaging: Direct Messages
  SEND_DM = 'sendDirectMessage',

  // Presence & Typing
  TYPING_START = 'typingStart',
  TYPING_STOP = 'typingStop',

  // Voice Channels
  VOICE_CHANNEL_JOIN = 'voice_channel_join',
  VOICE_CHANNEL_LEAVE = 'voice_channel_leave',
  VOICE_STATE_UPDATE = 'voice_state_update',
  VOICE_PRESENCE_REFRESH = 'voice_presence_refresh',

  // Threads
  SEND_THREAD_REPLY = 'sendThreadReply',
}
