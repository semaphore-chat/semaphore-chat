/**
 * Cache plumbing shared by the optimistic senders: text messages
 * (hooks/useOptimisticSendMessage.ts) and messages with attachments
 * (utils/attachmentSend.ts).
 */
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { VoiceSessionType } from "../contexts/VoiceContext";
import { channelMessagesQueryKey, dmMessagesQueryKey } from "./messageQueryKeys";
import {
  findMessageInInfinite,
  markOptimisticFailed,
  removeOptimisticMessage,
  replaceOptimisticMessage,
} from "./messageCacheUpdaters";
import type { Message } from "../types/message.type";
import type { PaginatedMessagesResponseDto } from "../api-client";
import type { MessageContext, SendMessageResult } from "../hooks/useSendMessage";

export type MessagesInfiniteData = InfiniteData<PaginatedMessagesResponseDto>;
export type MessageQueryKey =
  | ReturnType<typeof channelMessagesQueryKey>
  | ReturnType<typeof dmMessagesQueryKey>;

export function messagesQueryKeyFor(contextType: MessageContext, contextId: string): MessageQueryKey {
  return contextType === VoiceSessionType.Channel
    ? channelMessagesQueryKey(contextId)
    : dmMessagesQueryKey(contextId);
}

/**
 * Module-level in-flight guard (fix round 1, Important 3): prevents a
 * second submit for the SAME optimistic row's clientId from racing a send
 * that's already outstanding — e.g. a double-clicked Retry button, or Retry
 * firing while the original send is still in flight. Consulted by every
 * sender and retry so they see each other's in-flight state (retry runs in a
 * different hook instance than the composer's send).
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
export const inFlightClientIds = new Set<string>();

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
export function reconcileAfterSend(
  queryClient: QueryClient,
  queryKey: MessageQueryKey,
  clientId: string,
  optimisticMessage: Message,
  result: SendMessageResult,
): void {
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
