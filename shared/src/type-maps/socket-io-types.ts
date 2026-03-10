/**
 * Socket.IO type maps for server-to-client and client-to-server events.
 * These are plain TypeScript interfaces — no socket.io dependency required.
 * Pass these as generics to Socket<ServerToClientEvents, ClientToServerEvents>.
 */

import { ClientEvents } from '../events/client-events.enum';
import { ServerEvents } from '../events/server-events.enum';
import { Span, FileMetadata } from '../types/message.types';
import {
  AckPayload,
  ErrorPayload,
  NewMessagePayload,
  UpdateMessagePayload,
  DeleteMessagePayload,
  ReactionAddedPayload,
  ReactionRemovedPayload,
  ReadReceiptUpdatedPayload,
  NewNotificationPayload,
  NotificationReadPayload,
  UserOnlinePayload,
  UserOfflinePayload,
  UserTypingPayload,
  VoiceChannelUserJoinedPayload,
  VoiceChannelUserLeftPayload,
  VoiceChannelUserUpdatedPayload,
  DmVoiceCallStartedPayload,
  DmVoiceUserJoinedPayload,
  DmVoiceUserLeftPayload,
  DmVoiceUserUpdatedPayload,
  ReplayBufferStoppedPayload,
  ReplayBufferFailedPayload,
  ChannelsReorderedPayload,
  UserBannedPayload,
  UserKickedPayload,
  UserTimedOutPayload,
  TimeoutRemovedPayload,
  MessagePinnedPayload,
  MessageUnpinnedPayload,
  NewThreadReplyPayload,
  UpdateThreadReplyPayload,
  DeleteThreadReplyPayload,
  ThreadReplyCountUpdatedPayload,
  MemberAddedToCommunityPayload,
} from '../payloads/websocket-payloads';

/**
 * Server-to-Client WebSocket event types.
 */
export type ServerToClientEvents = {
  // Messaging: Channels
  [ServerEvents.NEW_MESSAGE]: (data: NewMessagePayload) => void;
  [ServerEvents.UPDATE_MESSAGE]: (data: UpdateMessagePayload) => void;
  [ServerEvents.DELETE_MESSAGE]: (data: DeleteMessagePayload) => void;

  // Message Reactions
  [ServerEvents.REACTION_ADDED]: (data: ReactionAddedPayload) => void;
  [ServerEvents.REACTION_REMOVED]: (data: ReactionRemovedPayload) => void;

  // Read Receipts
  [ServerEvents.READ_RECEIPT_UPDATED]: (data: ReadReceiptUpdatedPayload) => void;

  // Messaging: Direct Messages
  [ServerEvents.NEW_DM]: (data: NewMessagePayload) => void;

  // Mentions & Notifications
  [ServerEvents.NEW_NOTIFICATION]: (data: NewNotificationPayload) => void;
  [ServerEvents.NOTIFICATION_READ]: (data: NotificationReadPayload) => void;

  // Presence & Typing
  [ServerEvents.USER_ONLINE]: (data: UserOnlinePayload) => void;
  [ServerEvents.USER_OFFLINE]: (data: UserOfflinePayload) => void;
  [ServerEvents.USER_TYPING]: (data: UserTypingPayload) => void;

  // Voice Channels
  [ServerEvents.VOICE_CHANNEL_USER_JOINED]: (data: VoiceChannelUserJoinedPayload) => void;
  [ServerEvents.VOICE_CHANNEL_USER_LEFT]: (data: VoiceChannelUserLeftPayload) => void;
  [ServerEvents.VOICE_CHANNEL_USER_UPDATED]: (data: VoiceChannelUserUpdatedPayload) => void;

  // DM Voice Calls
  [ServerEvents.DM_VOICE_CALL_STARTED]: (data: DmVoiceCallStartedPayload) => void;
  [ServerEvents.DM_VOICE_USER_JOINED]: (data: DmVoiceUserJoinedPayload) => void;
  [ServerEvents.DM_VOICE_USER_LEFT]: (data: DmVoiceUserLeftPayload) => void;
  [ServerEvents.DM_VOICE_USER_UPDATED]: (data: DmVoiceUserUpdatedPayload) => void;

  // Replay Buffer (Screen Recording)
  [ServerEvents.REPLAY_BUFFER_STOPPED]: (data: ReplayBufferStoppedPayload) => void;
  [ServerEvents.REPLAY_BUFFER_FAILED]: (data: ReplayBufferFailedPayload) => void;

  // Threads
  [ServerEvents.NEW_THREAD_REPLY]: (data: NewThreadReplyPayload) => void;
  [ServerEvents.UPDATE_THREAD_REPLY]: (data: UpdateThreadReplyPayload) => void;
  [ServerEvents.DELETE_THREAD_REPLY]: (data: DeleteThreadReplyPayload) => void;
  [ServerEvents.THREAD_REPLY_COUNT_UPDATED]: (data: ThreadReplyCountUpdatedPayload) => void;

  // Channel Management
  [ServerEvents.CHANNELS_REORDERED]: (data: ChannelsReorderedPayload) => void;

  // Moderation Events
  [ServerEvents.USER_BANNED]: (data: UserBannedPayload) => void;
  [ServerEvents.USER_KICKED]: (data: UserKickedPayload) => void;
  [ServerEvents.USER_TIMED_OUT]: (data: UserTimedOutPayload) => void;
  [ServerEvents.TIMEOUT_REMOVED]: (data: TimeoutRemovedPayload) => void;
  [ServerEvents.MESSAGE_PINNED]: (data: MessagePinnedPayload) => void;
  [ServerEvents.MESSAGE_UNPINNED]: (data: MessageUnpinnedPayload) => void;

  // Community Membership
  [ServerEvents.MEMBER_ADDED_TO_COMMUNITY]: (data: MemberAddedToCommunityPayload) => void;

  // Acknowledgments & Errors
  [ServerEvents.ACK]: (data: AckPayload) => void;
  [ServerEvents.ERROR]: (data: ErrorPayload) => void;
};

/**
 * Client-to-Server WebSocket event types.
 */
export type ClientToServerEvents = {
  // Connection & Room Management
  [ClientEvents.SUBSCRIBE_ALL]: () => void;
  [ClientEvents.PRESENCE_ONLINE]: (data?: { idle?: boolean }) => void;

  // Messaging: Channels
  [ClientEvents.SEND_MESSAGE]: (
    data: {
      channelId: string;
      spans: Span[];
      attachments: FileMetadata[];
    },
    callback?: (messageId: string) => void
  ) => void;

  // Messaging: Direct Messages
  [ClientEvents.SEND_DM]: (
    data: {
      directMessageGroupId: string;
      spans: Span[];
      attachments: FileMetadata[];
    },
    callback?: (messageId: string) => void
  ) => void;

  // Message Reactions
  [ClientEvents.ADD_REACTION]: (data: { messageId: string; emoji: string }) => void;
  [ClientEvents.REMOVE_REACTION]: (data: { messageId: string; emoji: string }) => void;

  // Read Receipts
  [ClientEvents.MARK_AS_READ]: (data: {
    channelId?: string;
    directMessageGroupId?: string;
    lastReadMessageId: string;
  }) => void;

  // Threads
  [ClientEvents.SEND_THREAD_REPLY]: (
    data: {
      parentMessageId: string;
      spans: Span[];
      attachments?: string[];
      pendingAttachments?: number;
    },
    callback?: (replyId: string) => void
  ) => void;

  // Presence & Typing
  [ClientEvents.TYPING_START]: (data: {
    channelId?: string;
    directMessageGroupId?: string;
  }) => void;
  [ClientEvents.TYPING_STOP]: (data: {
    channelId?: string;
    directMessageGroupId?: string;
  }) => void;

  // Voice Channels
  [ClientEvents.VOICE_CHANNEL_JOIN]: (data: { channelId: string }) => void;
  [ClientEvents.VOICE_CHANNEL_LEAVE]: (data: { channelId: string }) => void;
  [ClientEvents.VOICE_STATE_UPDATE]: (data: {
    channelId: string;
    isVideoEnabled?: boolean;
    isScreenSharing?: boolean;
    isMuted?: boolean;
    isDeafened?: boolean;
  }) => void;
  [ClientEvents.VOICE_PRESENCE_REFRESH]: (data: { channelId: string }) => void;
};
