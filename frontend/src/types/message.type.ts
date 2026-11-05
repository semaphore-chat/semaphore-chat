export { SpanType, type Reaction, type FileMetadata, type LinkPreview } from '@semaphore-chat/shared';
import type { CreateMessageSpanDto, Message as WireMessage, ReplyToPreviewDto } from '@semaphore-chat/shared';

/**
 * A span as the client holds it. Spans from the server carry every field, but
 * a message being composed or sent optimistically only has the ones it set.
 */
export type Span = CreateMessageSpanDto;

/** Lifecycle status for an optimistically-sent message (PR-13). */
export type SendStatus = 'pending' | 'failed';

/**
 * Frontend message type: the wire `Message` (@semaphore-chat/shared), where
 * spans may be drafts, plus two fields used for optimistic sending:
 *
 * - `sendStatus`: `'pending'` while a locally-created message is waiting for
 *   the server ack/echo, `'failed'` if the send timed out or errored.
 *   Absent (`undefined`) for every real, server-sourced message.
 * - `clientId`: the id the client generated for an optimistic message
 *   (equal to its `id` while pending/failed — see useOptimisticSendMessage).
 *   Used to correlate an optimistic cache entry with its eventual ack/echo
 *   so a retry or reconciliation can find the right row without relying on
 *   `id` staying stable.
 *
 * Both fields are CACHE-LOCAL ONLY — they live in the TanStack Query cache
 * and are never included in an outgoing socket payload. `NewMessagePayload`
 * (hooks/useSendMessage.ts) explicitly omits them from the wire type.
 */
export interface Message extends Omit<WireMessage, 'spans' | 'replyTo'> {
  spans: Span[];
  replyTo: (Omit<ReplyToPreviewDto, 'spans'> & { spans: Span[] }) | null;
  sendStatus?: SendStatus;
  clientId?: string;
}

/** The fields a message has before anything has happened to it. */
export const EMPTY_MESSAGE_FIELDS = {
  channelId: null,
  directMessageGroupId: null,
  pendingAttachments: 0,
  linkPreviews: null,
  replyCount: 0,
  lastReplyAt: null,
  pinned: false,
  pinnedAt: null,
  pinnedBy: null,
  editedAt: null,
  deletedAt: null,
  parentMessageId: null,
  replyToId: null,
  replyTo: null,
  webhook: null,
} satisfies Partial<Message>;
