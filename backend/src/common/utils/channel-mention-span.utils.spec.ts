import { SpanType } from '@prisma/client';
import {
  sanitizeChannelMentionSpans,
  UNKNOWN_CHANNEL_MENTION_TEXT,
} from './channel-mention-span.utils';
import { flattenSpansToText } from './text.utils';

const HOME = 'home-channel';
const VISIBLE = 'visible-channel';
const HIDDEN = 'hidden-channel';
const OTHER_COMMUNITY = 'other-community-channel';

function makeDb() {
  return {
    channel: {
      findUnique: jest.fn().mockResolvedValue({ communityId: 'c1' }),
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in
            .filter((id) => id !== OTHER_COMMUNITY)
            .map((id) => ({ id })),
        ),
      ),
    },
  };
}

const canView = jest.fn((_userId: string, channelId: string) =>
  Promise.resolve(channelId !== HIDDEN),
);

const mention = (channelId: string, text: string | null = '#secret-name') => ({
  type: SpanType.CHANNEL_MENTION,
  text,
  channelId,
});

describe('sanitizeChannelMentionSpans', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps a mention of a visible channel in the same community, with no name stored', async () => {
    const db = makeDb();
    const [span] = await sanitizeChannelMentionSpans(
      db,
      [mention(VISIBLE)],
      HOME,
      'author',
      canView,
    );
    expect(span).toEqual({
      type: SpanType.CHANNEL_MENTION,
      text: null,
      channelId: VISIBLE,
    });
    expect(canView).toHaveBeenCalledWith('author', VISIBLE);
  });

  it.each([
    ['a channel the author cannot see', HIDDEN],
    ['a channel of another community', OTHER_COMMUNITY],
  ])('downgrades %s to plaintext', async (_name, channelId) => {
    const db = makeDb();
    const [span] = await sanitizeChannelMentionSpans(
      db,
      [mention(channelId)],
      HOME,
      'author',
      canView,
    );
    expect(span).toEqual({
      type: SpanType.PLAINTEXT,
      text: UNKNOWN_CHANNEL_MENTION_TEXT,
      channelId: null,
    });
  });

  it('downgrades every mention in a DM (no channel) without querying', async () => {
    const db = makeDb();
    const [span] = await sanitizeChannelMentionSpans(
      db,
      [mention(VISIBLE)],
      null,
      'author',
      canView,
    );
    expect(span.type).toBe(SpanType.PLAINTEXT);
    expect(db.channel.findUnique).not.toHaveBeenCalled();
  });

  it('downgrades when there is no author (webhooks)', async () => {
    const [span] = await sanitizeChannelMentionSpans(
      makeDb(),
      [mention(VISIBLE)],
      HOME,
      null,
      canView,
    );
    expect(span.type).toBe(SpanType.PLAINTEXT);
  });

  it('clears a stray channelId on other span types', async () => {
    const db = makeDb();
    const [span] = await sanitizeChannelMentionSpans(
      db,
      [{ type: SpanType.PLAINTEXT, text: 'hi', channelId: HIDDEN }],
      HOME,
      'author',
      canView,
    );
    expect(span).toEqual({
      type: SpanType.PLAINTEXT,
      text: 'hi',
      channelId: null,
    });
    expect(db.channel.findUnique).not.toHaveBeenCalled();
  });

  it('never lets a channel name reach the search text', async () => {
    const spans = await sanitizeChannelMentionSpans(
      makeDb(),
      [
        { type: SpanType.PLAINTEXT, text: 'see', channelId: null },
        mention(VISIBLE, '#visible-name'),
        mention(HIDDEN, '#hidden-name'),
      ],
      HOME,
      'author',
      canView,
    );
    const text = flattenSpansToText(spans) ?? '';
    expect(text).not.toContain('visible-name');
    expect(text).not.toContain('hidden-name');
  });
});
