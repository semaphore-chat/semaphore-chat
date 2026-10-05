import { SpanType } from '@prisma/client';

interface ChannelMentionSpanLike {
  type: SpanType;
  text?: string | null;
  channelId?: string | null;
}

/** Minimal Prisma-client surface needed to validate channel mentions. */
interface ChannelMentionDb {
  channel: {
    findUnique(args: {
      where: { id: string };
      select: { communityId: true };
    }): Promise<{ communityId: string } | null>;
    findMany(args: {
      where: { id: { in: string[] }; communityId: string };
      select: { id: true };
    }): Promise<{ id: string }[]>;
  };
}

/** What an invalid or hidden #channel mention is stored as. */
export const UNKNOWN_CHANNEL_MENTION_TEXT = '#unknown-channel';

/**
 * Validate CHANNEL_MENTION spans before persisting (create, edit, thread
 * reply).
 *
 * A #channel mention is kept only if it names a channel of the same
 * community as the message's channel AND the author can see it. Its `text`
 * is always stored as NULL: no channel name is ever written to the span,
 * the search index or push bodies, so a mention of a channel some readers
 * can't see leaks nothing (readers resolve the name from their own visible
 * channels). Anything else, including every mention in a DM, becomes
 * PLAINTEXT "#unknown-channel". `channelId` is cleared on every other span
 * type, so it can only ever reference a validated channel.
 *
 * No DB round-trips when the message has no CHANNEL_MENTION spans.
 */
export async function sanitizeChannelMentionSpans<
  T extends ChannelMentionSpanLike,
>(
  db: ChannelMentionDb,
  spans: T[],
  messageChannelId: string | null | undefined,
  authorId: string | null | undefined,
  canView: (userId: string, channelId: string) => Promise<boolean>,
): Promise<T[]> {
  const cleaned = spans.map((s) =>
    s.type !== SpanType.CHANNEL_MENTION && s.channelId
      ? { ...s, channelId: null }
      : s,
  );
  const mentioned = [
    ...new Set(
      cleaned
        .filter((s) => s.type === SpanType.CHANNEL_MENTION && s.channelId)
        .map((s) => s.channelId as string),
    ),
  ];
  if (!cleaned.some((s) => s.type === SpanType.CHANNEL_MENTION)) {
    return cleaned;
  }

  const valid = new Set<string>();
  if (messageChannelId && authorId && mentioned.length > 0) {
    const home = await db.channel.findUnique({
      where: { id: messageChannelId },
      select: { communityId: true },
    });
    if (home) {
      const sameCommunity = await db.channel.findMany({
        where: { id: { in: mentioned }, communityId: home.communityId },
        select: { id: true },
      });
      for (const { id } of sameCommunity) {
        if (await canView(authorId, id)) valid.add(id);
      }
    }
  }

  return cleaned.map((s) => {
    if (s.type !== SpanType.CHANNEL_MENTION) return s;
    return s.channelId && valid.has(s.channelId)
      ? { ...s, text: null }
      : {
          ...s,
          type: SpanType.PLAINTEXT,
          text: UNKNOWN_CHANNEL_MENTION_TEXT,
          channelId: null,
        };
  });
}
