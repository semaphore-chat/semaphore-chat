import { ServerEvents } from '@semaphore-chat/shared';

/**
 * Payload for the `message-fanout` queue. Deliberately minimal — the
 * processor re-reads the message (with spans/author) from the DB rather
 * than trusting a payload snapshot, so it always fans out against the
 * message's current state even if the job sat in the queue for a while.
 */
export interface MessageFanoutJobData {
  messageId: string;
}

/**
 * Payload for the `link-previews` queue. `room`/`event` are carried through
 * because they describe *where* to broadcast the re-processed message, not
 * its content — the processor re-reads spans from the DB for the same
 * always-current-state reason as message-fanout.
 */
export interface LinkPreviewJobData {
  messageId: string;
  room: string;
  // Only ever UPDATE_MESSAGE (re-processed message always broadcasts as an
  // update) — narrowed from ServerEvents so LinkPreviewsService's payload
  // type-checks against UpdateMessagePayload specifically.
  event: typeof ServerEvents.UPDATE_MESSAGE;
}

/**
 * Payload for the `timeout-expiry` queue, a delayed job that fires when a
 * community timeout ends. The processor re-reads the timeout and recomputes
 * the user's voice grants from current state, so an extended, re-applied or
 * lifted timeout needs no payload update. `expiresAt` (ISO) is informational.
 */
export interface TimeoutExpiryJobData {
  userId: string;
  communityId: string;
  expiresAt: string;
}
