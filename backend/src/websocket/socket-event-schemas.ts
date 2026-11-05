import { Type } from '@nestjs/common';
import { ClientEvents, ServerEvents } from '@semaphore-chat/shared';
import { AddReactionDto } from '@/messages/dto/add-reaction.dto';
import { CreateMessageDto } from '@/messages/dto/create-message.dto';
import {
  DeleteMessagePayloadDto,
  DeleteThreadReplyPayloadDto,
  MessagePinnedPayloadDto,
  MessageUnpinnedPayloadDto,
  NewMessagePayloadDto,
  NewThreadReplyPayloadDto,
  ReactionAddedPayloadDto,
  ReactionRemovedPayloadDto,
  ThreadReplyCountUpdatedPayloadDto,
  UpdateMessagePayloadDto,
  UpdateThreadReplyPayloadDto,
} from '@/messages/dto/message-events.dto';
import { RemoveReactionDto } from '@/messages/dto/remove-reaction.dto';
import { MarkAsReadDto } from '@/read-receipts/dto/mark-as-read.dto';
import { ReauthenticateDto } from '@/rooms/dto/reauthenticate.dto';
import { SendThreadReplyDto } from '@/threads/dto/send-thread-reply.dto';
import { TypingEventDto } from '@/messages/dto/typing-event.dto';
import { VoiceChannelEventDto } from '@/voice-presence/dto/voice-channel-event.dto';
import {
  ChannelCreatedPayloadDto,
  ChannelDeletedPayloadDto,
  ChannelPermissionsUpdatedPayloadDto,
  ChannelsReorderedPayloadDto,
  ChannelUpdatedPayloadDto,
  CommunityDeletedPayloadDto,
  CommunityUpdatedPayloadDto,
  DmVoiceCallStartedPayloadDto,
  DmVoiceUserJoinedPayloadDto,
  DmVoiceUserLeftPayloadDto,
  DmVoiceUserUpdatedPayloadDto,
  EgressSegmentsReadyPayloadDto,
  MemberAddedToCommunityPayloadDto,
  NewNotificationPayloadDto,
  NotificationReadPayloadDto,
  PresenceOnlineDto,
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
  TimeoutRemovedPayloadDto,
  TokenExpiringPayloadDto,
  UserBannedPayloadDto,
  UserKickedPayloadDto,
  UserPresencePayloadDto,
  UserProfileUpdatedPayloadDto,
  UserTimedOutPayloadDto,
  UserTypingPayloadDto,
  VoiceChannelUserJoinedPayloadDto,
  VoiceChannelUserLeftPayloadDto,
  VoiceChannelUserUpdatedPayloadDto,
} from './dto/socket-events.dto';

/**
 * Which schema each socket event's payload follows. The classes join the OpenAPI
 * components (createOpenApiDocument), and buildSocketEventIndex() publishes this
 * map as socket-events.json, so a generated client gets one type per shape and
 * only has to read event names from here.
 */
type UnindexedServerEvent = Exclude<
  ServerEvents,
  // In the enum, but nothing emits them. Their shapes are the send pipeline's.
  ServerEvents.ACK | ServerEvents.ERROR
>;

type PayloadClientEvent = Exclude<
  ClientEvents,
  // SUBSCRIBE_ALL takes no payload. The voice events are in the enum, but no
  // client sends them and no gateway handles them: voice goes through REST.
  | ClientEvents.SUBSCRIBE_ALL
  | ClientEvents.VOICE_CHANNEL_JOIN
  | ClientEvents.VOICE_CHANNEL_LEAVE
  | ClientEvents.VOICE_STATE_UPDATE
>;

export const SERVER_EVENT_SCHEMAS = {
  [ServerEvents.NEW_MESSAGE]: NewMessagePayloadDto,
  [ServerEvents.NEW_DM]: NewMessagePayloadDto,
  [ServerEvents.UPDATE_MESSAGE]: UpdateMessagePayloadDto,
  [ServerEvents.DELETE_MESSAGE]: DeleteMessagePayloadDto,
  [ServerEvents.REACTION_ADDED]: ReactionAddedPayloadDto,
  [ServerEvents.REACTION_REMOVED]: ReactionRemovedPayloadDto,
  [ServerEvents.NEW_THREAD_REPLY]: NewThreadReplyPayloadDto,
  [ServerEvents.UPDATE_THREAD_REPLY]: UpdateThreadReplyPayloadDto,
  [ServerEvents.DELETE_THREAD_REPLY]: DeleteThreadReplyPayloadDto,
  [ServerEvents.THREAD_REPLY_COUNT_UPDATED]: ThreadReplyCountUpdatedPayloadDto,
  [ServerEvents.MESSAGE_PINNED]: MessagePinnedPayloadDto,
  [ServerEvents.MESSAGE_UNPINNED]: MessageUnpinnedPayloadDto,
  [ServerEvents.TOKEN_EXPIRING]: TokenExpiringPayloadDto,
  [ServerEvents.SESSION_TERMINATED]: SessionTerminatedPayloadDto,
  [ServerEvents.READ_RECEIPT_UPDATED]: ReadReceiptUpdatedPayloadDto,
  [ServerEvents.NEW_NOTIFICATION]: NewNotificationPayloadDto,
  [ServerEvents.NOTIFICATION_READ]: NotificationReadPayloadDto,
  [ServerEvents.USER_ONLINE]: UserPresencePayloadDto,
  [ServerEvents.USER_OFFLINE]: UserPresencePayloadDto,
  [ServerEvents.USER_TYPING]: UserTypingPayloadDto,
  [ServerEvents.VOICE_CHANNEL_USER_JOINED]: VoiceChannelUserJoinedPayloadDto,
  [ServerEvents.VOICE_CHANNEL_USER_LEFT]: VoiceChannelUserLeftPayloadDto,
  [ServerEvents.VOICE_CHANNEL_USER_UPDATED]: VoiceChannelUserUpdatedPayloadDto,
  [ServerEvents.DM_VOICE_CALL_STARTED]: DmVoiceCallStartedPayloadDto,
  [ServerEvents.DM_VOICE_USER_JOINED]: DmVoiceUserJoinedPayloadDto,
  [ServerEvents.DM_VOICE_USER_LEFT]: DmVoiceUserLeftPayloadDto,
  [ServerEvents.DM_VOICE_USER_UPDATED]: DmVoiceUserUpdatedPayloadDto,
  [ServerEvents.REPLAY_BUFFER_STOPPED]: ReplayBufferStoppedPayloadDto,
  [ServerEvents.REPLAY_BUFFER_FAILED]: ReplayBufferFailedPayloadDto,
  [ServerEvents.EGRESS_SEGMENTS_READY]: EgressSegmentsReadyPayloadDto,
  [ServerEvents.CHANNELS_REORDERED]: ChannelsReorderedPayloadDto,
  [ServerEvents.CHANNEL_CREATED]: ChannelCreatedPayloadDto,
  [ServerEvents.CHANNEL_UPDATED]: ChannelUpdatedPayloadDto,
  [ServerEvents.CHANNEL_DELETED]: ChannelDeletedPayloadDto,
  [ServerEvents.CHANNEL_PERMISSIONS_UPDATED]:
    ChannelPermissionsUpdatedPayloadDto,
  [ServerEvents.USER_BANNED]: UserBannedPayloadDto,
  [ServerEvents.USER_KICKED]: UserKickedPayloadDto,
  [ServerEvents.USER_TIMED_OUT]: UserTimedOutPayloadDto,
  [ServerEvents.TIMEOUT_REMOVED]: TimeoutRemovedPayloadDto,
  [ServerEvents.MEMBER_ADDED_TO_COMMUNITY]: MemberAddedToCommunityPayloadDto,
  [ServerEvents.COMMUNITY_UPDATED]: CommunityUpdatedPayloadDto,
  [ServerEvents.COMMUNITY_DELETED]: CommunityDeletedPayloadDto,
  [ServerEvents.ROLE_CREATED]: RoleCreatedPayloadDto,
  [ServerEvents.ROLE_UPDATED]: RoleUpdatedPayloadDto,
  [ServerEvents.ROLE_DELETED]: RoleDeletedPayloadDto,
  [ServerEvents.ROLE_ASSIGNED]: RoleAssignedPayloadDto,
  [ServerEvents.ROLE_UNASSIGNED]: RoleUnassignedPayloadDto,
  [ServerEvents.USER_PROFILE_UPDATED]: UserProfileUpdatedPayloadDto,
} satisfies Record<UnindexedServerEvent, Type<unknown>>;

export const CLIENT_EVENT_SCHEMAS = {
  [ClientEvents.SEND_MESSAGE]: CreateMessageDto,
  [ClientEvents.SEND_DM]: CreateMessageDto,
  [ClientEvents.ADD_REACTION]: AddReactionDto,
  [ClientEvents.REMOVE_REACTION]: RemoveReactionDto,
  [ClientEvents.SEND_THREAD_REPLY]: SendThreadReplyDto,
  [ClientEvents.PRESENCE_ONLINE]: PresenceOnlineDto,
  [ClientEvents.REAUTHENTICATE]: ReauthenticateDto,
  [ClientEvents.MARK_AS_READ]: MarkAsReadDto,
  [ClientEvents.TYPING_START]: TypingEventDto,
  [ClientEvents.TYPING_STOP]: TypingEventDto,
  [ClientEvents.VOICE_PRESENCE_REFRESH]: VoiceChannelEventDto,
} satisfies Record<PayloadClientEvent, Type<unknown>>;

/** The acknowledgement a client event answers with, where it has a schema. */
export const CLIENT_EVENT_ACK_SCHEMAS = {
  [ClientEvents.REAUTHENTICATE]: ReauthenticateResultDto,
} satisfies Partial<Record<ClientEvents, Type<unknown>>>;

export const SOCKET_EVENT_SCHEMAS: Type<unknown>[] = [
  ...new Set([
    ...Object.values(SERVER_EVENT_SCHEMAS),
    ...Object.values(CLIENT_EVENT_SCHEMAS),
    ...Object.values(CLIENT_EVENT_ACK_SCHEMAS),
  ]),
];

const componentRef = (schema: Type<unknown>) => ({
  $ref: `./openapi.json#/components/schemas/${schema.name}`,
});

const byEventName = <T>(entries: Record<string, T>) =>
  Object.fromEntries(
    Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)),
  );

export function buildSocketEventIndex() {
  const client: Record<string, object> = {
    [ClientEvents.SUBSCRIBE_ALL]: {},
  };
  for (const [event, schema] of Object.entries(CLIENT_EVENT_SCHEMAS)) {
    client[event] = { payload: componentRef(schema) };
  }
  for (const [event, schema] of Object.entries(CLIENT_EVENT_ACK_SCHEMAS)) {
    client[event] = { ...client[event], ack: componentRef(schema) };
  }

  return {
    description:
      'Socket.IO events and the OpenAPI component each payload follows. Readers must ignore unknown events and unknown fields, and treat an unknown enum value as a fallback.',
    server: byEventName(
      Object.fromEntries(
        Object.entries(SERVER_EVENT_SCHEMAS).map(([event, schema]) => [
          event,
          { payload: componentRef(schema) },
        ]),
      ),
    ),
    client: byEventName(client),
  };
}
