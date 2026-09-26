import type { InfiniteData } from '@tanstack/react-query';
import type { PaginatedMessagesResponseDto } from '../api-client/types.gen';
import type { Message } from '../types/message.type';

// `Message` (from @semaphore-chat/shared) and `EnrichedMessageDto` (generated API types) are
// structurally identical but TypeScript treats them as distinct. `as never` is the
// minimal assertion to bridge between WebSocket payloads and the TQ cache type.

// --- InfiniteData updaters (used by both channel and DM caches) ---

/**
 * True when the infinite window no longer contains the live newest page.
 * The live page is fetched with pageParam '' (initialPageParam); after
 * MESSAGE_MAX_PAGES eviction the first stored param is an older cursor.
 * Test factories use `undefined` for the live page — treat both '' and
 * null/undefined as "live".
 */
export function isDetachedFromLiveEdge(
  data: InfiniteData<PaginatedMessagesResponseDto> | undefined,
): boolean {
  const first = data?.pageParams[0];
  return first != null && first !== '';
}

export function prependMessageToInfinite(
  old: InfiniteData<PaginatedMessagesResponseDto> | undefined,
  message: Message,
): InfiniteData<PaginatedMessagesResponseDto> | undefined {
  if (!old) return old;
  // Never insert into a detached window: pages[0] is not the live newest
  // page, so prepending here would splice the message into mid-history.
  if (isDetachedFromLiveEdge(old)) return old;
  const firstPage = old.pages[0];
  if (!firstPage) return old;
  if (firstPage.messages.some(m => m.id === message.id)) return old;
  return {
    ...old,
    pages: [
      { ...firstPage, messages: [message as never, ...firstPage.messages] },
      ...old.pages.slice(1),
    ],
  };
}

/**
 * Replace the cached message with the same id. A row that was sent
 * optimistically keeps its `clientId` (server payloads never carry one), so
 * its React key stays stable and an update — e.g. an attachment landing on
 * a message whose files are still uploading — never remounts it.
 */
export function updateMessageInInfinite(
  old: InfiniteData<PaginatedMessagesResponseDto> | undefined,
  message: Message,
): InfiniteData<PaginatedMessagesResponseDto> | undefined {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map(page => ({
      ...page,
      messages: page.messages.map(m => {
        if (m.id !== message.id) return m;
        const clientId = (m as unknown as Message).clientId;
        return (clientId && !message.clientId ? { ...message, clientId } : message) as never;
      }),
    })),
  };
}

export function deleteMessageFromInfinite(
  old: InfiniteData<PaginatedMessagesResponseDto> | undefined,
  messageId: string,
): InfiniteData<PaginatedMessagesResponseDto> | undefined {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map(page => ({
      ...page,
      messages: page.messages.filter(m => m.id !== messageId),
    })),
  };
}

/** Find a message across all pages of an infinite query */
export function findMessageInInfinite(
  data: InfiniteData<PaginatedMessagesResponseDto> | undefined,
  messageId: string,
): Message | undefined {
  if (!data) return undefined;
  for (const page of data.pages) {
    const found = page.messages.find(m => m.id === messageId);
    if (found) return found as unknown as Message;
  }
  return undefined;
}

// --- Optimistic send (PR-13) ---
//
// An optimistic message is inserted with `id === clientId` and
// `sendStatus: 'pending'`. It's reconciled with the server in one of two
// ways depending on which arrives first:
//   - ack-first:  useOptimisticSendMessage's ack callback (has messageId,
//     not the full message) calls `replaceOptimisticMessage`, swapping the
//     optimistic row's identity to the real id in place.
//   - echo-first: the WS NEW_MESSAGE handler calls `prependOrReconcileOptimistic`,
//     which finds the matching optimistic row and swaps it for the full real
//     message in the SAME cache update (not remove-then-insert), so no
//     render can ever show both.
// Whichever runs first "wins" the swap; the other is then a no-op against
// an id/clientId that's already gone — see reconcileAfterSend in
// hooks/useOptimisticSendMessage.ts for the ack-side idempotency check.
//
// Multi-pending correlation invariant (fix round 1): with more than one
// optimistic row in flight for the same author (e.g. a timed-out send left
// a 'failed' bubble while a fresh send is 'pending'), authorId ALONE is not
// enough to pick the right row — see the doc comment on
// `prependOrReconcileOptimistic` below for the content-equality rule that
// replaces it.

/** Prefix of the temporary id (and clientId) of an optimistic message. */
export const OPTIMISTIC_ID_PREFIX = 'pending-';

/**
 * True for an optimistic message's temporary id (`pending-<uuid>`), which the
 * server has never seen. Such an id must never go over the wire as a
 * message reference (e.g. a read mark).
 */
export function isOptimisticMessageId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

/** True if a cached row is a not-yet-settled optimistic message. */
function isOptimisticRow(message: unknown): boolean {
  const status = (message as Message).sendStatus;
  return status === 'pending' || status === 'failed';
}

/**
 * Flattens a message's spans to plain text for echo-correlation purposes
 * only (NOT a general-purpose renderer — mentions/formatting are collapsed
 * to their raw `text`). This is a client-side heuristic standing in for a
 * real correlation key; the durable fix is a server-echoed client nonce in
 * the broadcast payload (backend + shared change, tracked as a follow-up).
 */
function flattenSpansText(spans: Message['spans'] | undefined): string {
  return (spans ?? []).map(s => s.text ?? '').join('');
}

/**
 * Content-equality check used to disambiguate among multiple same-author
 * optimistic rows. Compares flattened span text and the number of files the
 * message announced (`pendingAttachments`) — sufficient to tell two
 * different in-flight sends apart without needing a real nonce.
 */
function isSameOptimisticContent(a: Message, b: Message): boolean {
  return (
    flattenSpansText(a.spans) === flattenSpansText(b.spans) &&
    // Messages with files are often captionless: the file count keeps an
    // echo of one from reconciling a different captionless send.
    (a.pendingAttachments ?? 0) === (b.pendingAttachments ?? 0)
  );
}

/**
 * Insert a WS-echoed message, reconciling it in place with a matching
 * optimistic row if one exists — the echo can arrive before the sender's
 * own ack (echo-first), or after the ack already promoted/removed a row
 * (in which case this is an id-match merge, not a correlation match — see
 * below). Falls back to a plain prepend (dedup-by-id, live-edge-only — same
 * rules as `prependMessageToInfinite`) when neither applies.
 *
 * Two distinct cases, handled in order:
 *
 * 1. **Id already present** (most commonly: ack-first already promoted the
 *    optimistic row to this same real id, and the echo is now confirming
 *    it). MERGE the echo payload into the existing row — echo wins for
 *    server-derived fields — instead of skipping, so enrichment the ack
 *    didn't carry (e.g. a resolved `replyTo`) isn't permanently lost. The
 *    row's `clientId` (if any) is preserved through the merge so the row
 *    keeps a stable React key across the swap (see VirtualMessageList).
 *
 * 2. **Correlation match**: find an optimistic ('pending' OR 'failed') row
 *    from the SAME author whose flattened span text is content-EQUAL to the
 *    incoming message. Content equality — not authorId alone — is required
 *    because more than one optimistic row can be in flight for the same
 *    author at once (a fresh send while an earlier one is still 'failed'
 *    from a timeout). Author-only matching would let one send's echo
 *    reconcile a completely unrelated row.
 *
 *    'failed' rows ARE eligible for this content-exact match: a late echo
 *    for a row that already timed out means the server actually received
 *    it, so replacing the failed row with the real message is correct — it
 *    prevents a subsequent Retry from double-posting. 'failed' rows are
 *    NEVER eligible for a looser author-only match, only this exact one.
 *
 *    If no row matches on author+content, falls through to a plain insert
 *    (no reconcile) — an unreconciled optimistic row is still safe: it
 *    resolves via its own ack (exact clientId) or eventually times out to
 *    'failed'.
 *
 * Known v1 gap: if a single author has two sends in flight with byte-for-
 * byte IDENTICAL content, this can't tell them apart (picks the first
 * match). Rare in practice (would require sending the same text twice
 * before either resolves) and self-healing either way — the ack-side
 * reconciliation is idempotent regardless of which row got matched first.
 */
export function prependOrReconcileOptimistic(
  old: InfiniteData<PaginatedMessagesResponseDto> | undefined,
  message: Message,
): InfiniteData<PaginatedMessagesResponseDto> | undefined {
  if (!old) return old;
  if (isDetachedFromLiveEdge(old)) return old;
  const firstPage = old.pages[0];
  if (!firstPage) return old;

  const existingIdIndex = firstPage.messages.findIndex(m => m.id === message.id);
  if (existingIdIndex >= 0) {
    const existing = firstPage.messages[existingIdIndex] as unknown as Message;
    const merged = { ...existing, ...message, clientId: existing.clientId } as never;
    const messages = firstPage.messages.map((m, i) => (i === existingIdIndex ? merged : m));
    return {
      ...old,
      pages: [{ ...firstPage, messages }, ...old.pages.slice(1)],
    };
  }

  const optimisticIndex = firstPage.messages.findIndex(
    m =>
      isOptimisticRow(m) &&
      (m as unknown as Message).authorId === message.authorId &&
      isSameOptimisticContent(m as unknown as Message, message),
  );

  const messages = optimisticIndex >= 0
    ? firstPage.messages.map((m, i) => {
        if (i !== optimisticIndex) return m;
        const matched = m as unknown as Message;
        return { ...message, clientId: matched.clientId } as never;
      })
    : [message as never, ...firstPage.messages];

  return {
    ...old,
    pages: [{ ...firstPage, messages }, ...old.pages.slice(1)],
  };
}

/**
 * True if a cached row is still the unreconciled optimistic placeholder for
 * `clientId` — i.e. `id === clientId`, which only holds before promotion/
 * reconciliation changes `id` to the real server id. Every clientId-keyed
 * mutation below (`replaceOptimisticMessage`, `removeOptimisticMessage`,
 * `markOptimisticFailed`, `markOptimisticPending`) uses this guard, NOT a
 * bare `clientId` match, because fix round 1 intentionally RETAINS
 * `clientId` on a row after it's reconciled (for stable React keying — see
 * `prependOrReconcileOptimistic`). Without this guard, a clientId-only match
 * could hit an already-settled real message and wrongly mutate it — e.g. a
 * lost ack (echo arrived and reconciled, but the ack itself times out)
 * would otherwise flip a persisted message back to 'failed'.
 */
function isUnreconciledPlaceholder(message: unknown, clientId: string): boolean {
  const msg = message as Message;
  return msg.clientId === clientId && msg.id === clientId;
}

/**
 * Reconciliation: replace the optimistic row matched by `clientId` with the
 * real, server-sourced message (or server-shaped promotion of the
 * optimistic content). No-op (returns `old` unchanged) if no still-
 * unreconciled row with that clientId is found — either the echo-first race
 * already reconciled/removed it via `prependOrReconcileOptimistic`, or (see
 * `isUnreconciledPlaceholder`) it's already settled and must not be touched.
 */
export function replaceOptimisticMessage(
  old: InfiniteData<PaginatedMessagesResponseDto> | undefined,
  clientId: string,
  realMessage: Message,
): InfiniteData<PaginatedMessagesResponseDto> | undefined {
  if (!old) return old;
  let found = false;
  const pages = old.pages.map(page => ({
    ...page,
    messages: page.messages.map(m => {
      if (isUnreconciledPlaceholder(m, clientId)) {
        found = true;
        return realMessage as never;
      }
      return m;
    }),
  }));
  if (!found) return old;
  return { ...old, pages };
}

/**
 * Remove the optimistic row matched by `clientId` without inserting
 * anything. Used when the WS echo already inserted the real message
 * (ack-after-echo — the real row already exists under its own id, so the
 * placeholder is redundant) and for the user-facing "delete failed message"
 * action.
 *
 * Only removes a row that's STILL the unreconciled placeholder — see
 * `isUnreconciledPlaceholder`. Without this guard, the ack-side "the echo
 * already inserted the real row, so my placeholder is redundant" cleanup
 * would delete that already-reconciled row instead of leaving it alone.
 */
export function removeOptimisticMessage(
  old: InfiniteData<PaginatedMessagesResponseDto> | undefined,
  clientId: string,
): InfiniteData<PaginatedMessagesResponseDto> | undefined {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map(page => ({
      ...page,
      messages: page.messages.filter(m => !isUnreconciledPlaceholder(m, clientId)),
    })),
  };
}

/**
 * Set `sendStatus: 'failed'` on the optimistic row matched by `clientId`.
 * Guarded by `isUnreconciledPlaceholder` (not a bare clientId match) — e.g.
 * a lost ack for a send whose echo already reconciled the row must NOT flip
 * that now-settled, real message back to 'failed'.
 */
export function markOptimisticFailed(
  old: InfiniteData<PaginatedMessagesResponseDto> | undefined,
  clientId: string,
): InfiniteData<PaginatedMessagesResponseDto> | undefined {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map(page => ({
      ...page,
      messages: page.messages.map(m =>
        isUnreconciledPlaceholder(m, clientId)
          ? ({ ...(m as unknown as Message), sendStatus: 'failed' } as never)
          : m,
      ),
    })),
  };
}

/**
 * Reset a 'failed' optimistic row back to 'pending' — used at the start of
 * a retry, before the retry's send has settled. Keeps the same clientId/id
 * so no duplicate row is created. Guarded by `isUnreconciledPlaceholder` for
 * the same reason as `markOptimisticFailed`.
 */
export function markOptimisticPending(
  old: InfiniteData<PaginatedMessagesResponseDto> | undefined,
  clientId: string,
): InfiniteData<PaginatedMessagesResponseDto> | undefined {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map(page => ({
      ...page,
      messages: page.messages.map(m =>
        isUnreconciledPlaceholder(m, clientId)
          ? ({ ...(m as unknown as Message), sendStatus: 'pending' } as never)
          : m,
      ),
    })),
  };
}

