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
import { SendThreadReplyDto } from '@/threads/dto/send-thread-reply.dto';

/**
 * Which schema each socket event's payload follows. The classes join the OpenAPI
 * components (createOpenApiDocument), and buildSocketEventIndex() publishes this
 * map as socket-events.json, so a generated client gets one type per shape and
 * only has to read event names from here.
 */
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
} satisfies Partial<Record<ServerEvents, Type<unknown>>>;

export const CLIENT_EVENT_SCHEMAS = {
  [ClientEvents.SEND_MESSAGE]: CreateMessageDto,
  [ClientEvents.SEND_DM]: CreateMessageDto,
  [ClientEvents.ADD_REACTION]: AddReactionDto,
  [ClientEvents.REMOVE_REACTION]: RemoveReactionDto,
  [ClientEvents.SEND_THREAD_REPLY]: SendThreadReplyDto,
} satisfies Partial<Record<ClientEvents, Type<unknown>>>;

export const SOCKET_EVENT_SCHEMAS: Type<unknown>[] = [
  ...new Set([
    ...Object.values(SERVER_EVENT_SCHEMAS),
    ...Object.values(CLIENT_EVENT_SCHEMAS),
  ]),
];

const toIndex = (schemas: Record<string, Type<unknown>>) =>
  Object.fromEntries(
    Object.entries(schemas)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([event, schema]) => [
        event,
        {
          payload: {
            $ref: `./openapi.json#/components/schemas/${schema.name}`,
          },
        },
      ]),
  );

export function buildSocketEventIndex() {
  return {
    description:
      'Socket.IO events and the OpenAPI component each payload follows. Readers must ignore unknown events and unknown fields, and treat an unknown enum value as a fallback.',
    server: toIndex(SERVER_EVENT_SCHEMAS),
    client: toIndex(CLIENT_EVENT_SCHEMAS),
  };
}
