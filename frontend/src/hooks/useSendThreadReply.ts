import { useCallback, useContext, useRef } from "react";
import { ClientEvents } from "@semaphore-chat/shared";
import { SocketContext } from "../utils/SocketContext";
import type { Span } from "../types/message.type";
import { logger } from "../utils/logger";
import { randomUuid } from "../utils/deviceId";
import { describeSendFailure, emitSend, isDeletedWhileSending, type SendResult } from "../utils/sendAck";

/** What a thread reply's send came to, for the composer: whether to clear the field, and what to tell the reader. */
export interface ThreadReplyOutcome {
  /** The server has the reply (or it was deleted meanwhile): the field and its nonce are done with. */
  clear: boolean;
  /** The reply's id, when the server acked one. */
  messageId?: string;
  /** Why it was not sent, for people ("That reply was deleted", the server's reason); undefined when sent. */
  error?: string;
}

export interface ThreadReplyRequest {
  /** The text as typed (trimmed): the nonce stays the same while it does. */
  content: string;
  spans: Span[];
  /** Files that will be uploaded to the reply once the server has it (`utils/attachmentSend`). */
  pendingAttachments?: number;
}

/**
 * Sends a thread reply over the socket (SEND_THREAD_REPLY), shared by both shells' thread composers: the one place
 * a thread reply reaches the raw socket (a named emitter of the Lounge import boundary). The same nonce goes with
 * the same text until it goes through, so sending it again after a lost ack cannot post it twice. Never rejects.
 *
 * Not connected: nothing is sent and nothing is said (the old thread composer's rule; the offline banner says it).
 */
export function useSendThreadReply(parentMessageId: string) {
  const { socket } = useContext(SocketContext);
  const nonceRef = useRef<{ content: string; clientNonce: string } | null>(null);

  const sendReply = useCallback(
    async ({ content, spans, pendingAttachments = 0 }: ThreadReplyRequest): Promise<ThreadReplyOutcome | null> => {
      if (!socket?.connected) return null;
      if (nonceRef.current?.content !== content) {
        nonceRef.current = { content, clientNonce: randomUuid() };
      }
      const result: SendResult = await emitSend(socket, ClientEvents.SEND_THREAD_REPLY, {
        parentMessageId,
        spans,
        attachments: [],
        pendingAttachments,
        clientNonce: nonceRef.current.clientNonce,
      });
      const deleted = isDeletedWhileSending(result.error);
      if (result.success || deleted) nonceRef.current = null;
      if (result.success) return { clear: true, messageId: result.messageId };
      logger.error("Failed to send thread reply:", result.error);
      return { clear: deleted, error: deleted ? "That reply was deleted" : describeSendFailure(result.error) };
    },
    [socket, parentMessageId],
  );

  return { sendReply };
}
