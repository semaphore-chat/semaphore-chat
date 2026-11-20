import { isOptimisticMessageId } from '../../utils/messageCacheUpdaters';
import type { Message } from '../../types/message.type';

/**
 * The newest message `me` can edit with ↑ in an empty composer: theirs, not
 * deleted, sent (no pending/failed `sendStatus`) and not an optimistic copy.
 * `messages` are newest first. Null when `me` is unknown ('') or none match.
 */
export function findLastEditableMessage(messages: Message[], me: string): Message | null {
  if (!me) return null;
  return (
    messages.find(
      (m) => m.authorId === me && !m.deletedAt && m.sendStatus === undefined && !isOptimisticMessageId(m.id),
    ) ?? null
  );
}
