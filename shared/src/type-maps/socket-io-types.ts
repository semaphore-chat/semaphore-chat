/**
 * Socket.IO type maps for server-to-client and client-to-server events.
 * These are plain TypeScript interfaces — no socket.io dependency required.
 * Pass these as generics to Socket<ServerToClientEvents, ClientToServerEvents>.
 */

import type { SendAck } from '../errors';
import { ClientEvents } from '../events/client-events.enum';
import type { CreateMessageDto } from '../generated';
import {
  ServerEventPayloads,
  ReauthenticateResult,
} from '../payloads/websocket-payloads';

/**
 * Server-to-Client WebSocket event types.
 *
 * Derived from {@link ServerEventPayloads} so the socket typing always covers
 * every server event (the previous hand-maintained map drifted out of sync).
 */
export type ServerToClientEvents = {
  [E in keyof ServerEventPayloads]: (data: ServerEventPayloads[E]) => void;
};

/**
 * Client-to-Server WebSocket event types.
 */
export type ClientToServerEvents = {
  // Connection & Room Management
  [ClientEvents.SUBSCRIBE_ALL]: () => void;
  [ClientEvents.PRESENCE_ONLINE]: (data?: { idle?: boolean }) => void;
  [ClientEvents.REAUTHENTICATE]: (
    data: { token: string },
    callback: (result: ReauthenticateResult) => void
  ) => void;

  // Messaging: Channels
  [ClientEvents.SEND_MESSAGE]: (
    data: CreateMessageDto & { channelId: string },
    callback?: (ack: string | SendAck) => void
  ) => void;

  // Messaging: Direct Messages
  [ClientEvents.SEND_DM]: (
    data: CreateMessageDto & { directMessageGroupId: string },
    callback?: (ack: string | SendAck) => void
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
      spans: CreateMessageDto['spans'];
      attachments?: string[];
      pendingAttachments?: number;
    },
    callback?: (ack: string | SendAck) => void
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
