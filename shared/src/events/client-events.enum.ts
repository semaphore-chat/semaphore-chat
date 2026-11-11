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
  TYPING_STOP = 'typingStop',  // Threads
  SEND_THREAD_REPLY = 'sendThreadReply',
}
