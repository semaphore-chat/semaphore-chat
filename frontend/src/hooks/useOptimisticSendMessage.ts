import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "./useCurrentUser";
import {
  useSendMessage,
  type NewMessagePayload,
  type SendMessageResult,
  type MessageContext,
} from "./useSendMessage";
import { VoiceSessionType } from "../contexts/VoiceContext";
import {
  prependMessageToInfinite,
  removeOptimisticMessage,
  markOptimisticPending,
  isDetachedFromLiveEdge,
  OPTIMISTIC_ID_PREFIX,
} from "../utils/messageCacheUpdaters";
import {
  inFlightClientIds,
  messagesQueryKeyFor,
  reconcileAfterSend,
  type MessagesInfiniteData,
} from "../utils/optimisticSend";
import {
  discardAttachmentSend,
  hasAttachmentSend,
  pendingAttachmentCount,
  startAttachmentUploads,
} from "../utils/attachmentSend";
import type { Message } from "../types/message.type";

// reconcileAfterSend and the in-flight guard live in utils/optimisticSend.ts,
// shared with the attachment sender (utils/attachmentSend.ts).

export interface UseOptimisticSendMessageResult {
  sendMessage: (payload: NewMessagePayload) => Promise<SendMessageResult>;
  canSend: boolean;
}

/**
 * Wraps useSendMessage with an optimistic pending bubble: the message
 * appears immediately (before the server round-trip), then reconciles with
 * whichever of the ack / WS echo arrives first (see reconcileAfterSend and
 * prependOrReconcileOptimistic in messageCacheUpdaters.ts for both-order
 * safety — a render can never observe both the optimistic row and the real
 * message at once).
 *
 * Scope (v1):
 * - Only inserts optimistically in NORMAL mode at the LIVE EDGE. A detached
 *   normal-mode window (deep scrollback past MESSAGE_MAX_PAGES, #404) is
 *   guarded here directly (falls back to a plain send with no optimistic
 *   row); anchored mode is a wholly separate query key that this hook never
 *   touches, so it's excluded by construction. See the PR-13 report for why
 *   "skip" was chosen over "insert + force jump" for the detached case: the
 *   existing, regression-tested own-send detached-reset in
 *   messageHandlers.handleNewMessage already handles it correctly once the
 *   real echo lands, and duplicating that dance here would be fragile for
 *   very little value (perceived-latency wins matter at the live edge,
 *   which is not where a detached reader's attention is anyway).
 * - Messages with attachments don't come through here: useMessageFileUpload
 *   routes them to utils/attachmentSend.ts, which inserts the same kind of
 *   optimistic row and then runs the uploads.
 */
export function useOptimisticSendMessage(
  contextType: MessageContext,
  contextId: string,
): UseOptimisticSendMessageResult {
  const queryClient = useQueryClient();
  const { user: currentUser } = useCurrentUser();
  const { sendMessage: rawSendMessage, canSend } = useSendMessage(contextType);
  const queryKey = messagesQueryKeyFor(contextType, contextId);

  const sendMessage = useCallback(
    async (payload: NewMessagePayload): Promise<SendMessageResult> => {
      const authorId = payload.authorId ?? currentUser?.id ?? null;
      const existing = queryClient.getQueryData<MessagesInfiniteData>(queryKey);

      // Scope guard: skip the optimistic row when detached from the live
      // edge (prependMessageToInfinite would no-op anyway, but skipping here
      // also avoids creating a 'pending'/'failed' row that would never be
      // visible until a reset — see the doc comment above).
      if (isDetachedFromLiveEdge(existing)) {
        return rawSendMessage(payload);
      }

      const clientId = `${OPTIMISTIC_ID_PREFIX}${crypto.randomUUID()}`;
      const optimisticMessage: Message = {
        ...payload,
        authorId,
        id: clientId,
        clientId,
        sendStatus: "pending",
      } as Message;

      queryClient.setQueryData(queryKey, (old: unknown) =>
        prependMessageToInfinite(old as never, optimisticMessage),
      );

      inFlightClientIds.add(clientId);
      try {
        const result = await rawSendMessage(payload);
        reconcileAfterSend(queryClient, queryKey, clientId, optimisticMessage, result);
        return result;
      } finally {
        inFlightClientIds.delete(clientId);
      }
    },
    [queryClient, queryKey, currentUser, rawSendMessage],
  );

  return { sendMessage, canSend };
}

/**
 * Builds the wire payload for a retry from an explicit field allowlist —
 * NOT destructure-and-spread of the cached `Message` — so a future
 * cache-only field added to `Message` (alongside `sendStatus`/`clientId`)
 * can't silently leak onto the wire just by existing on the object. Mirrors
 * the fields useMessageFileUpload's handleSendMessage builds for the
 * original (non-attachment) send.
 */
function buildRetryPayload(message: Message, sentAt: string, pendingAttachments: number): NewMessagePayload {
  return {
    ...(message.channelId ? { channelId: message.channelId } : {}),
    ...(message.directMessageGroupId ? { directMessageGroupId: message.directMessageGroupId } : {}),
    authorId: message.authorId,
    spans: message.spans,
    attachments: message.attachments,
    // Files still to upload for this message (utils/attachmentSend.ts).
    pendingAttachments,
    reactions: message.reactions,
    sentAt,
    ...(message.replyToId ? { replyToId: message.replyToId } : {}),
  };
}

export interface UseOptimisticMessageRetryResult {
  /** Re-emits the message with the SAME clientId — never creates a duplicate row. */
  retry: () => Promise<void>;
  /** Removes the optimistic row (and any files it was going to upload). No API call — it was never persisted. */
  remove: () => void;
}

/**
 * Retry/delete actions for a 'pending'/'failed' optimistic message.
 *
 * Self-contained — called directly by the row that renders the message
 * (mirrors useMessageActions), so retry/delete don't need to be threaded
 * down as props through the container → VirtualMessageList chain.
 */
export function useOptimisticMessageRetry(message: Message): UseOptimisticMessageRetryResult {
  const queryClient = useQueryClient();
  const contextType = message.channelId ? VoiceSessionType.Channel : VoiceSessionType.Dm;
  const contextId = message.channelId || message.directMessageGroupId || "";
  const { sendMessage: rawSendMessage } = useSendMessage(contextType);
  const queryKey = messagesQueryKeyFor(contextType, contextId);

  const retry = useCallback(async () => {
    const clientId = message.clientId;
    if (!clientId) return;
    // Guard: a retry already in flight for this clientId (e.g. double-clicked
    // Retry) no-ops rather than firing a second concurrent send.
    if (inFlightClientIds.has(clientId)) return;

    const sentAt = new Date().toISOString();
    const retryPayload = buildRetryPayload(message, sentAt, pendingAttachmentCount(clientId));
    const optimisticMessage: Message = { ...message, sentAt, sendStatus: "pending" };

    queryClient.setQueryData(queryKey, (old: unknown) => markOptimisticPending(old as never, clientId));

    inFlightClientIds.add(clientId);
    try {
      const result = await rawSendMessage(retryPayload);
      reconcileAfterSend(queryClient, queryKey, clientId, optimisticMessage, result);
      // A message with files: now that it exists, upload them.
      if (result.success && result.messageId && hasAttachmentSend(clientId)) {
        startAttachmentUploads(clientId, result.messageId);
      }
    } finally {
      inFlightClientIds.delete(clientId);
    }
  }, [message, queryClient, queryKey, rawSendMessage]);

  const remove = useCallback(() => {
    const clientId = message.clientId;
    if (!clientId) return;
    discardAttachmentSend(clientId);
    queryClient.setQueryData(queryKey, (old: unknown) => removeOptimisticMessage(old as never, clientId));
  }, [message, queryClient, queryKey]);

  return { retry, remove };
}
