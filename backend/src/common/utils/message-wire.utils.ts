import { Message } from '@semaphore-chat/shared';
import { blankRemovedMessage } from './removed-message.utils';

/**
 * TODO(any-cleanup): Casts an enriched Prisma message object (from
 * `MessagesService.create()` / `enrichMessageWithFileMetadata()`, or an
 * equivalent hand-built re-read like `LinkPreviewsService.broadcastMessage`)
 * to the shared wire `Message` DTO for WebsocketService emits.
 *
 * The two shapes structurally diverge in ways that go deeper than a single
 * field: Prisma's `SpanType`/`ChannelType` enums are distinct TS types from
 * the shared string-literal enums (identical runtime values, different
 * nominal types), and several columns are raw `Date` / `null` on the Prisma
 * side where the shared DTO documents the post-JSON-serialization wire
 * shape (`string` timestamps, `undefined`-style optionals). The Date half
 * of that gap is now closed at runtime by the WebsocketService boundary
 * (see below); making the *static types* line up without any cast would
 * still require a full field-by-field Prisma -> wire-DTO mapper — a genuine
 * refactor, out of scope here (callers are the WS emit paths in messages,
 * threads, link-previews, and clips).
 *
 * This cast does not change what is actually emitted — it hands the exact
 * same runtime value to `.emit()` that was passed in, just relabeled to
 * satisfy the static type at the WebsocketService boundary. It does NOT
 * itself perform the Date -> ISO-string wire conversion; that runtime gap
 * (the Redis adapter's notepack encoding has no Date codec, so raw Date
 * fields arrived as empty objects on clients connected to OTHER replicas)
 * is resolved centrally at the WebsocketService boundary — see
 * `toWirePayload` in `@/websocket/websocket-wire.util`, which JSON-roundtrips
 * every payload before `.emit()` so the runtime now matches the type
 * declared here. Fixes #440.
 *
 * The parameter is constrained to values that are at least plausibly a
 * message (has `id`, `spans`, `sentAt`) rather than `unknown`, so this
 * can't silently launder an unrelated object into a `Message`.
 *
 * A broadcast has one payload for its whole room, so a removed message always
 * goes out blank here, whoever is in the room.
 */
export function toWireMessage<
  T extends {
    id: string;
    spans: unknown[];
    sentAt: Date;
    deletedAt?: Date | null;
  },
>(message: T): Message {
  return blankRemovedMessage(message) as unknown as Message;
}
