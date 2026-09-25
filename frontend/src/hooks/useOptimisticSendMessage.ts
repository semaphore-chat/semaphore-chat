import { useCallback } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useCurrentUser } from "./useCurrentUser";
import {
  useSendMessage,
  type NewMessagePayload,
  type SendMessageResult,
  type MessageContext,
} from "./useSendMessage";
import { VoiceSessionType } from "../contexts/VoiceContext";
import { channelMessagesQueryKey, dmMessagesQueryKey } from "../utils/messageQueryKeys";
import {
  prependMessageToInfinite,
  replaceOptimisticMessage,
  removeOptimisticMessage,
  markOptimisticFailed,
  markOptimisticPending,
  findMessageInInfinite,
  isDetachedFromLiveEdge,
  OPTIMISTIC_ID_PREFIX,
} from "../utils/messageCacheUpdaters";
import type { Message } from "../types/message.type";
import type { PaginatedMessagesResponseDto } from "../api-client";

type MessagesInfiniteData = InfiniteData<PaginatedMessagesResponseDto>;
type MessageQueryKey = ReturnType<typeof channelMessagesQueryKey> | ReturnType<typeof dmMessagesQueryKey>;

function queryKeyFor(contextType: MessageContext, contextId: string): MessageQueryKey {
  return contextType === VoiceSessionType.Channel
    ? channelMessagesQueryKey(contextId)
    : dmMessagesQueryKey(contextId);
}

/**
 * Applies the outcome of a (re)send to the cache.
 *
 * Ack always wins cleanup — this runs regardless of WS-echo timing:
 * - success + the real id is already in the cache (the echo beat the ack):
 *   the optimistic row is now redundant, just remove it.
 * - success + the real id is NOT in the cache yet (ack beat the echo):
 *   promote the optimistic row in place to the real id (best-effort — we
 *   only have `messageId` from the ack, not the full enriched message, so
 *   this keeps our own locally-known content). `clientId` is intentionally
 *   KEPT (not cleared) on the promoted row so it keeps a stable React key
 *   across the id swap (see VirtualMessageList's row keying). When the echo
 *   arrives after, `prependOrReconcileOptimistic`'s id-match branch now
 *   MERGES the echo into this row instead of no-op'ing on the id-already-
 *   present check — so any richer content the echo carries (e.g. a resolved
 *   `replyTo`) still lands (fix round 1; previously permanently dropped).
 * - failure: mark 'failed' for the retry/delete UI.
 *
 * This is a no-op against a clientId that's already gone (the echo-first
 * case above already reconciled it via `prependOrReconcileOptimistic`).
 */
function reconcileAfterSend(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: MessageQueryKey,
  clientId: string,
  optimisticMessage: Message,
  result: SendMessageResult,
) {
  queryClient.setQueryData(queryKey, (old: unknown) => {
    const typedOld = old as MessagesInfiniteData | undefined;
    if (result.success && result.messageId) {
      const echoAlreadyInserted = !!findMessageInInfinite(typedOld, result.messageId);
      if (echoAlreadyInserted) {
        return removeOptimisticMessage(typedOld, clientId);
      }
      const promoted: Message = {
        ...optimisticMessage,
        id: result.messageId,
        sendStatus: undefined,
      };
      return replaceOptimisticMessage(typedOld, clientId, promoted);
    }
    return markOptimisticFailed(typedOld, clientId);
  });
}

/**
 * Module-level in-flight guard (fix round 1, Important 3): prevents a
 * second submit for the SAME optimistic row's clientId from racing a send
 * that's already outstanding — e.g. a double-clicked Retry button, or Retry
 * firing while the original send is still in flight. Consulted by both
 * `sendMessage` and `retry` so they see each other's in-flight state
 * (retry runs in a different hook instance than the composer's send).
 *
 * This does NOT prevent multiple DIFFERENT optimistic rows from being in
 * flight concurrently for the same author (composer send + a retry of an
 * older failed row, or two sequential composer sends) — that's expected
 * and handled by the content-based echo correlation in
 * `prependOrReconcileOptimistic`, not by this guard.
 *
 * Module-level (not component/hook-instance state) because it must be
 * shared across every hook instance that could touch the same clientId.
 */
const inFlightClientIds = new Set<string>();

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
 * - Messages with pending attachments are the CALLER's responsibility to
 *   exclude — see hooks/useMessageFileUpload.ts, which routes attachment
 *   sends through the plain useSendMessage + upload-then-attach flow
 *   instead of this hook.
 */
export function useOptimisticSendMessage(
  contextType: MessageContext,
  contextId: string,
): UseOptimisticSendMessageResult {
  const queryClient = useQueryClient();
  const { user: currentUser } = useCurrentUser();
  const { sendMessage: rawSendMessage, canSend } = useSendMessage(contextType);
  const queryKey = queryKeyFor(contextType, contextId);

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
function buildRetryPayload(message: Message, sentAt: string): NewMessagePayload {
  return {
    ...(message.channelId ? { channelId: message.channelId } : {}),
    ...(message.directMessageGroupId ? { directMessageGroupId: message.directMessageGroupId } : {}),
    authorId: message.authorId,
    spans: message.spans,
    attachments: message.attachments,
    reactions: message.reactions,
    sentAt,
    ...(message.replyToId ? { replyToId: message.replyToId } : {}),
  };
}

export interface UseOptimisticMessageRetryResult {
  /** Re-emits the message with the SAME clientId — never creates a duplicate row. */
  retry: () => Promise<void>;
  /** Removes the optimistic row from the cache. No API call — it was never persisted. */
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
  const queryKey = queryKeyFor(contextType, contextId);

  const retry = useCallback(async () => {
    const clientId = message.clientId;
    if (!clientId) return;
    // Guard: a retry already in flight for this clientId (e.g. double-clicked
    // Retry) no-ops rather than firing a second concurrent send.
    if (inFlightClientIds.has(clientId)) return;

    const sentAt = new Date().toISOString();
    const retryPayload = buildRetryPayload(message, sentAt);
    const optimisticMessage: Message = { ...message, sentAt, sendStatus: "pending" };

    queryClient.setQueryData(queryKey, (old: unknown) => markOptimisticPending(old as never, clientId));

    inFlightClientIds.add(clientId);
    try {
      const result = await rawSendMessage(retryPayload);
      reconcileAfterSend(queryClient, queryKey, clientId, optimisticMessage, result);
    } finally {
      inFlightClientIds.delete(clientId);
    }
  }, [message, queryClient, queryKey, rawSendMessage]);

  const remove = useCallback(() => {
    const clientId = message.clientId;
    if (!clientId) return;
    queryClient.setQueryData(queryKey, (old: unknown) => removeOptimisticMessage(old as never, clientId));
  }, [message, queryClient, queryKey]);

  return { retry, remove };
}
