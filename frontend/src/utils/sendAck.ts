/**
 * Sending over the socket and reading the answer. Clients connect with
 * `auth.protocol` (socketSingleton.ts), so a current server answers with a
 * SendAck and a failure arrives at once. An older self-hosted server acks a
 * plain message id and says nothing on failure, which the timeout covers.
 */
import type { Socket } from "socket.io-client";
import { ErrorCode, type SendAck } from "@semaphore-chat/shared";
import { randomUuid } from "./deviceId";

export const SEND_ACK_TIMEOUT_MS = 10000;

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: Error;
}

/** A send the server refused. `message` is the server's, for people to read. */
export class SendFailedError extends Error {
  constructor(readonly errorCode: ErrorCode | string, message: string) {
    super(message);
    this.name = "SendFailedError";
  }
}

export function readSendAck(ack: string | SendAck): SendResult {
  if (typeof ack === "string") return { success: true, messageId: ack };
  if (ack.ok) return { success: true, messageId: ack.messageId };
  const { errorCode, message } = ack.error;
  return { success: false, error: new SendFailedError(errorCode, message) };
}

/** Emits a send and resolves with its outcome. Never rejects. */
export function emitSend(
  socket: Socket,
  event: string,
  payload: unknown,
): Promise<SendResult> {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        success: false,
        error: new Error("Message send timed out. Please try again."),
      });
    }, SEND_ACK_TIMEOUT_MS);

    socket.emit(event, payload, (ack: string | SendAck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(readSendAck(ack));
    });
  });
}

/** What to tell the sender. Generic refusals read badly as the server words them. */
export function describeSendFailure(error: Error | undefined): string {
  if (error instanceof SendFailedError) {
    switch (error.errorCode) {
      // A blocked DM gets the wording the web used before it had a code of its own.
      case ErrorCode.FORBIDDEN:
      case ErrorCode.DM_BLOCKED:
        return "You can't send messages here";
      case ErrorCode.VALIDATION_FAILED:
      case ErrorCode.INTERNAL:
      case ErrorCode.UNKNOWN:
        return "Failed to send";
      default:
        return error.message || "Failed to send";
    }
  }
  return "Failed to send";
}

/** The message was deleted before the sender heard it was sent: nothing to retry. */
export function isDeletedWhileSending(error: Error | undefined): boolean {
  return (
    error instanceof SendFailedError &&
    error.errorCode === ErrorCode.MESSAGE_DELETED
  );
}

/**
 * A new send's identity: the nonce the server echoes, and the optimistic row's
 * id. A retry reuses both, which is what makes it safe.
 */
export function newSendIdentity(prefix: string) {
  const clientNonce = randomUuid();
  return { clientNonce, clientId: `${prefix}${clientNonce}` };
}
