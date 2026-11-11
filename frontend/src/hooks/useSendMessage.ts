import { useContext, useCallback } from "react";
import type { Socket } from "socket.io-client";
import { VoiceSessionType } from "../contexts/VoiceContext";
import { logger } from "../utils/logger";
import { SocketContext } from "../utils/SocketContext";
import { ClientEvents } from '@semaphore-chat/shared';
import type { Message } from "../types/message.type";
import { emitSend, type SendResult } from "../utils/sendAck";

// What a send starts from: what the message says, plus what an optimistic row
// shows until the server answers. sendStatus/clientId are cache-local fields
// (see types/message.type.ts) and must never be part of an outgoing socket
// payload, so they aren't here.
export type NewMessagePayload = Pick<Message, "authorId" | "spans" | "attachments" | "reactions" | "sentAt"> & {
  channelId?: string | null;
  directMessageGroupId?: string | null;
  pendingAttachments?: number | null;
  replyToId?: string | null;
  clientNonce?: string | null;
};

export type MessageContext = VoiceSessionType;

/**
 * Error thrown when attempting to send a message without a socket connection
 */
export class SocketNotConnectedError extends Error {
  constructor() {
    super("Socket not connected. Please check your connection and try again.");
    this.name = "SocketNotConnectedError";
  }
}

/** Result of sending a message. */
export type SendMessageResult = SendResult;

/**
 * Wait for socket reconnection with a timeout.
 * Returns true if connected within the timeout, false otherwise.
 */
function waitForReconnection(socket: Socket, timeoutMs: number): Promise<boolean> {
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.off('connect', onConnect);
      resolve(false);
    }, timeoutMs);
    const onConnect = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    socket.once('connect', onConnect);
  });
}

/**
 * Unified hook for sending messages in both channels and DMs
 * @param contextType - 'channel' or 'dm'
 * @param callback - Optional callback that receives the messageId after server creates it
 * @returns sendMessage function that returns a Promise with the result
 */
export function useSendMessage(
  contextType: MessageContext,
  callback?: (messageId: string) => void
) {
  const { socket, isConnected } = useContext(SocketContext);

  const sendMessage = useCallback(
    (payload: NewMessagePayload): Promise<SendMessageResult> => {
      return new Promise((resolve) => {
        if (!socket) {
          const error = new SocketNotConnectedError();
          logger.error("[useSendMessage]", error.message);
          resolve({ success: false, error });
          return;
        }

        const doSend = () => {
          // The context type determines the event and implies which context id
          // the payload carries (callers build the payload for the same context
          // they pass as contextType).
          const wirePayload = { ...payload, attachments: payload.attachments.map((file) => file.id) };
          void emitSend(
            socket,
            contextType === VoiceSessionType.Channel
              ? ClientEvents.SEND_MESSAGE
              : ClientEvents.SEND_DM,
            wirePayload,
          ).then((result) => {
            if (result.success && result.messageId) callback?.(result.messageId);
            resolve(result);
          });
        };

        if (!socket.connected) {
          // Wait for reconnection before failing
          logger.warn("[useSendMessage] Socket disconnected, waiting for reconnection...");
          waitForReconnection(socket, 5000).then((connected) => {
            if (!connected) {
              const error = new SocketNotConnectedError();
              logger.error("[useSendMessage] Reconnection timed out");
              resolve({ success: false, error });
              return;
            }
            doSend();
          });
          return;
        }

        doSend();
      });
    },
    [socket, contextType, callback]
  );

  /**
   * Check if sending is possible (socket is connected)
   */
  const canSend = isConnected;

  return { sendMessage, canSend };
}
