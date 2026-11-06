/** The part of a message row that decides whether it was removed. */
export interface RemovableMessage {
  deletedAt?: Date | string | null;
  channelId?: string | null;
}

/**
 * The form of a removed message for readers who may not see its content: it
 * keeps its identity, author and timestamps, and nothing it said. Rows stay
 * in lists so pagination, read markers and thread parents keep working.
 */
export function blankRemovedMessage<T extends RemovableMessage>(message: T): T {
  if (!message.deletedAt) return message;
  return {
    ...message,
    spans: [],
    attachments: [],
    reactions: [],
    linkPreviews: null,
    pendingAttachments: 0,
    replyToId: null,
    replyTo: null,
    searchText: null,
    deletedBy: null,
    deletedByReason: null,
  };
}

/**
 * Blanks the removed messages among `messages`, except in channels where
 * `canSeeRemoved` allows the reader to see them. Asks once per channel, and
 * not at all when nothing was removed.
 */
export async function blankRemovedMessagesForReader<T extends RemovableMessage>(
  messages: T[],
  canSeeRemoved: (channelId: string) => Promise<boolean>,
): Promise<T[]> {
  if (!messages.some((message) => message.deletedAt)) return messages;

  const allowedByChannel = new Map<string, Promise<boolean>>();
  return Promise.all(
    messages.map(async (message) => {
      if (!message.deletedAt) return message;
      const { channelId } = message;
      if (!channelId) return blankRemovedMessage(message);
      let allowed = allowedByChannel.get(channelId);
      if (!allowed) {
        allowed = canSeeRemoved(channelId);
        allowedByChannel.set(channelId, allowed);
      }
      return (await allowed) ? message : blankRemovedMessage(message);
    }),
  );
}
