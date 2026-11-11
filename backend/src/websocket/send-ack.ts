import {
  ClientEvents,
  SendAck,
  SOCKET_PROTOCOL_SEND_ACK,
} from '@semaphore-chat/shared';
import type { Socket } from 'socket.io';

/** The events that answer with a SendAck for a client that asked for one. */
const SEND_ACK_EVENTS: ReadonlySet<string> = new Set([
  ClientEvents.SEND_MESSAGE,
  ClientEvents.SEND_DM,
  ClientEvents.SEND_THREAD_REPLY,
]);

/**
 * Old clients treat any ack as the message id, so they only get a SendAck if
 * they ask for it by connecting with `auth.protocol`.
 */
function wantsSendAck(client: Socket): boolean {
  const protocol = (client.handshake.auth as { protocol?: unknown } | undefined)
    ?.protocol;
  return typeof protocol === 'number' && protocol >= SOCKET_PROTOCOL_SEND_ACK;
}

/** What a send handler returns: the plain id, or a SendAck for those who asked. */
export function sendSuccessAck(
  client: Socket,
  messageId: string,
): string | SendAck {
  return wantsSendAck(client) ? { ok: true, messageId } : messageId;
}

/** Whether a failure of this event should also answer the ack. */
export function answersFailureWithAck(
  client: Socket,
  pattern: unknown,
): boolean {
  return (
    typeof pattern === 'string' &&
    SEND_ACK_EVENTS.has(pattern) &&
    wantsSendAck(client)
  );
}
