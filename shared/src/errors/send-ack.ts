import type { ApiErrorFields } from './error-codes.enum';

/**
 * The `auth.protocol` value a client sends when connecting to get a SendAck
 * from SEND_MESSAGE, SEND_DM and SEND_THREAD_REPLY. Without it, a successful
 * send acks the plain message id and a failure only sends an `exception` event.
 */
export const SOCKET_PROTOCOL_SEND_ACK = 2;

export type SendAck =
  | { ok: true; messageId: string }
  | { ok: false; error: ApiErrorFields & { message: string } };
