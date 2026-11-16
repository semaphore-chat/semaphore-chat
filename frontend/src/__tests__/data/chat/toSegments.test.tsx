/**
 * `toSegments` follows the old renderer (components/Message/MessageSpan.tsx) case by case: each case renders the
 * same spans both ways and compares what a reader gets (the words, and where links go).
 */
import { describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { renderMessageSpans } from '../../../components/Message/MessageSpan';
import { MessageText } from '../../../kit';
import { HIDDEN_CHANNEL_LABEL, segmentsLine, toSegments } from '../../../data/chat/toSegments';
import { SpanType, type Span } from '../../../types/message.type';
import { renderWithProviders } from '../../test-utils';
import { renderWithKit } from '../../test-utils/renderWithKit';

const emoji = { id: 'e-1', name: 'partyparrot', fileId: 'f-1' };
const emojiById = new Map([[emoji.id, emoji]]);

function classic(spans: Span[]) {
  const { container } = renderWithProviders(<div>{renderMessageSpans(spans, emojiById as never)}</div>);
  const out = read(container);
  cleanup();
  return out;
}

function lounge(spans: Span[]) {
  const { container } = renderWithKit(<MessageText segments={toSegments(spans, { emojiById, fileUrl: (id) => `/api/file/${id}` })} />);
  const out = read(container);
  cleanup();
  return out;
}

/**
 * The kit shows a link as its parsed address (`MessageText`'s rule: what you see is where it goes), so a bare host
 * gains the URL parser's "/" (`https://example.com/`). That is the only drawing difference; it is evened out here
 * and pinned on its own below.
 */
const bareHostSlash = (text: string) => text.replace(/(https?:\/\/[^/\s]+)\/(?=\s|$)/g, '$1');

/** What a reader gets: the visible words (images as their alt text) and the links' targets. */
function read(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('img').forEach((img) => img.replaceWith(img.getAttribute('alt') ?? ''));
  // Words only visible to screen readers ("mentions you") are the kit's addition; drop them for the comparison.
  return {
    text: bareHostSlash((clone.textContent ?? '').replace(/, mentions you/g, '')),
    links: [...container.querySelectorAll('a')].map((a) => bareHostSlash(a.getAttribute('href') ?? '')),
  };
}

const CASES: [string, Span[]][] = [
  ['plain text', [{ type: SpanType.PLAINTEXT, text: 'Hello world' }]],
  ['a user mention', [{ type: SpanType.USER_MENTION, text: '@testuser', userId: 'u1' }]],
  ['a user mention without text falls back to the id', [{ type: SpanType.USER_MENTION, userId: 'user-abc-123' }]],
  ['a special mention', [{ type: SpanType.SPECIAL_MENTION, specialKind: 'here' }]],
  ['a community mention', [{ type: SpanType.COMMUNITY_MENTION, text: '@community', communityId: 'c1' }]],
  ['an alias mention', [{ type: SpanType.ALIAS_MENTION, text: '@devteam', aliasId: 'a1' }]],
  ['a URL', [{ type: SpanType.PLAINTEXT, text: 'Visit https://example.com for info' }]],
  ['two URLs', [{ type: SpanType.PLAINTEXT, text: 'See https://a.com and http://b.com here' }]],
  ['trailing punctuation', [{ type: SpanType.PLAINTEXT, text: 'Go to https://example.com/page. Then https://x.org/a?b=c!' }]],
  ['dots in a path', [{ type: SpanType.PLAINTEXT, text: 'file at https://example.com/a.b/c.d.html' }]],
  ['bold', [{ type: SpanType.PLAINTEXT, text: 'strong', bold: true }]],
  ['italic and strike', [{ type: SpanType.PLAINTEXT, text: 'both', italic: true, strikethrough: true }]],
  ['inline code is not linked', [{ type: SpanType.PLAINTEXT, text: 'https://example.com', code: true }]],
  ['a code block', [{ type: SpanType.CODE_BLOCK, text: 'const a = 1;\nconst b = 2;' }]],
  ['a known emoji', [{ type: SpanType.EMOJI, emojiId: 'e-1', text: ':partyparrot:' }]],
  ['an unknown emoji', [{ type: SpanType.EMOJI, emojiId: 'gone', text: ':oldparrot:' }]],
  [
    'several spans',
    [
      { type: SpanType.PLAINTEXT, text: 'Hey ' },
      { type: SpanType.USER_MENTION, text: '@aiko', userId: 'u1' },
      { type: SpanType.PLAINTEXT, text: ', see ' },
      { type: SpanType.PLAINTEXT, text: 'this', bold: true },
    ],
  ],
];

describe('toSegments draws what the old renderer draws', () => {
  it.each(CASES)('%s', (_, spans) => {
    expect(lounge(spans)).toEqual(classic(spans));
  });

  it('a channel the reader cannot see is the old "#private-channel", unavailable', () => {
    const spans: Span[] = [{ type: SpanType.CHANNEL_MENTION, channelId: 'hidden' }];
    expect(classic(spans).text).toBe(HIDDEN_CHANNEL_LABEL);
    expect(toSegments(spans, { channelById: () => undefined })).toEqual([
      { type: 'mention', kind: 'channel', text: HIDDEN_CHANNEL_LABEL, unavailable: true },
    ]);
  });
});

describe('toSegments', () => {
  it('the one drawing difference: the kit shows a bare host as the parser writes it, with its "/"', () => {
    const spans: Span[] = [{ type: SpanType.PLAINTEXT, text: 'https://example.com' }];
    const { container } = renderWithKit(<MessageText segments={toSegments(spans)} />);
    expect(container.querySelector('a')).toHaveAttribute('href', 'https://example.com/');
    cleanup();
  });

  it('a visible channel mention names it and links to it', () => {
    const channel = { id: 'ch-1', name: 'clips', communityId: 'c-1' };
    expect(toSegments([{ type: SpanType.CHANNEL_MENTION, channelId: 'ch-1' }], { channelById: () => channel })).toEqual([
      { type: 'mention', kind: 'channel', text: '#clips', id: 'ch-1', href: '#/community/c-1/channel/ch-1' },
    ]);
    expect(
      toSegments([{ type: SpanType.CHANNEL_MENTION, channelId: 'ch-1' }], {
        channelById: () => channel,
        channelHref: (c) => `#/__lounge/community/${c.communityId}/channel/${c.id}`,
      })[0],
    ).toMatchObject({ href: '#/__lounge/community/c-1/channel/ch-1' });
  });

  it('marks mentions of the reader: their own name, @everyone and @here', () => {
    const [mine, other, here] = toSegments(
      [
        { type: SpanType.USER_MENTION, text: '@me', userId: 'u-me' },
        { type: SpanType.USER_MENTION, text: '@you', userId: 'u-you' },
        { type: SpanType.SPECIAL_MENTION, specialKind: 'here' },
      ],
      { me: 'u-me' },
    );
    expect(mine).toMatchObject({ me: true, id: 'u-me' });
    expect(other).not.toHaveProperty('me');
    expect(here).toMatchObject({ kind: 'everyone', text: '@here', me: true });
  });

  it('keeps formatting on a link inside a formatted span', () => {
    expect(toSegments([{ type: SpanType.PLAINTEXT, text: 'see https://x.org', bold: true }])).toEqual([
      { type: 'text', text: 'see ', bold: true },
      { type: 'link', href: 'https://x.org', bold: true },
    ]);
  });

  it('an empty span draws nothing', () => {
    expect(toSegments([{ type: SpanType.PLAINTEXT, text: '' }])).toEqual([]);
  });

  it('segmentsLine reads segments as one line', () => {
    expect(segmentsLine(toSegments([{ type: SpanType.PLAINTEXT, text: 'a\n b  https://x.org' }]))).toBe('a b https://x.org');
  });
});
