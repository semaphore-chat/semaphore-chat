import { describe, it, expect } from 'vitest';
import {
  findMentions,
  getCodeRegions,
  parseMessageWithMentions,
  spansToText,
  getCurrentMention,
  insertMention,
  resolveMentionText,
} from '../../utils/mentionParser';
import { SpanType } from '../../types/message.type';

describe('findMentions', () => {
  it('finds @user mentions as type user with correct position', () => {
    const result = findMentions('hello @alice');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'user',
      start: 6,
      end: 12,
      text: '@alice',
      query: 'alice',
    });
  });

  it('finds @here and @channel as type special', () => {
    const result = findMentions('@here and @channel');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({ type: 'special', query: 'here', text: '@here' }),
    );
    expect(result[1]).toEqual(
      expect.objectContaining({ type: 'special', query: 'channel', text: '@channel' }),
    );
  });

  it('finds #channel mentions as type channel', () => {
    const result = findMentions('go to #general');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({ type: 'channel', query: 'general', text: '#general' }),
    );
  });

  it('returns multiple mentions sorted by position', () => {
    const result = findMentions('@bob check #dev and @alice');
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('user');
    expect(result[0].query).toBe('bob');
    expect(result[1].type).toBe('channel');
    expect(result[1].query).toBe('dev');
    expect(result[2].type).toBe('user');
    expect(result[2].query).toBe('alice');
    // Verify sorted by position
    expect(result[0].start).toBeLessThan(result[1].start);
    expect(result[1].start).toBeLessThan(result[2].start);
  });

  it('returns empty array for plain text with no mentions', () => {
    expect(findMentions('just some plain text')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(findMentions('')).toEqual([]);
  });

  it('handles hyphens and underscores in mention names', () => {
    const result = findMentions('@my-user and @my_user');
    expect(result).toHaveLength(2);
    expect(result[0].query).toBe('my-user');
    expect(result[1].query).toBe('my_user');
  });

  it('excludes @mentions inside inline code', () => {
    const result = findMentions('use `@alice` in code');
    expect(result).toHaveLength(0);
  });

  it('excludes @mentions inside fenced code blocks', () => {
    const result = findMentions('```\n@alice\n```');
    expect(result).toHaveLength(0);
  });

  it('excludes #channel mentions inside inline code', () => {
    const result = findMentions('type `#general` to reference');
    expect(result).toHaveLength(0);
  });

  it('finds mentions outside code but skips mentions inside code', () => {
    const result = findMentions('@bob said `@alice` is great');
    expect(result).toHaveLength(1);
    expect(result[0].query).toBe('bob');
  });

  it('excludes mentions inside fenced code blocks with language', () => {
    const result = findMentions('```js\n@alice\n```');
    expect(result).toHaveLength(0);
  });
});

describe('getCodeRegions', () => {
  it('finds inline code regions', () => {
    const regions = getCodeRegions('hello `code` world');
    expect(regions).toEqual([[6, 12]]);
  });

  it('finds fenced code block regions', () => {
    const regions = getCodeRegions('before ```\ncode\n``` after');
    expect(regions).toEqual([[7, 19]]);
  });

  it('returns empty array for text without code', () => {
    expect(getCodeRegions('no code here')).toEqual([]);
  });
});

describe('parseMessageWithMentions', () => {
  it('returns a single PLAINTEXT span for plain text', () => {
    const spans = parseMessageWithMentions('hello world');
    expect(spans).toEqual([{ type: SpanType.PLAINTEXT, text: 'hello world' }]);
  });

  it('creates USER_MENTION span when username matches a user', () => {
    const users = [{ id: 'u1', username: 'alice' }];
    const spans = parseMessageWithMentions('@alice', users);
    expect(spans).toEqual([
      { type: SpanType.USER_MENTION, text: '@alice', userId: 'u1' },
    ]);
  });

  it('creates ALIAS_MENTION span when mention matches alias group (checked before user)', () => {
    const users = [{ id: 'u1', username: 'devs' }];
    const aliases = [{ id: 'a1', name: 'devs' }];
    const spans = parseMessageWithMentions('@devs', users, [], aliases);
    // Alias is checked before user, so alias wins
    expect(spans).toEqual([
      { type: SpanType.ALIAS_MENTION, text: '@devs', aliasId: 'a1' },
    ]);
  });

  it('creates SPECIAL_MENTION span for @here', () => {
    const spans = parseMessageWithMentions('@here');
    expect(spans).toEqual([
      { type: SpanType.SPECIAL_MENTION, text: '@here', specialKind: 'here' },
    ]);
  });

  it('creates a CHANNEL_MENTION span with only the channel id (no name) when a channel matches', () => {
    const channels = [{ id: 'c1', name: 'general' }];
    const spans = parseMessageWithMentions('#general', [], channels);
    expect(spans).toEqual([{ type: SpanType.CHANNEL_MENTION, channelId: 'c1' }]);
    expect(JSON.stringify(spans)).not.toContain('general');
  });

  it('spansToText names #channel mentions from the visible channels, else #private-channel', () => {
    const spans = [
      { type: SpanType.CHANNEL_MENTION, channelId: 'c1' },
      { type: SpanType.PLAINTEXT, text: ' and ' },
      { type: SpanType.CHANNEL_MENTION, channelId: 'hidden' },
    ];
    const names = new Map([['c1', 'general']]);
    expect(spansToText(spans, (id) => names.get(id))).toBe(
      '#general and #private-channel',
    );
    expect(spansToText(spans)).toBe('#private-channel and #private-channel');
  });

  it('an edited message round-trips its visible #channel mention', () => {
    const channels = [{ id: 'c1', name: 'general' }];
    const text = spansToText(
      [{ type: SpanType.CHANNEL_MENTION, channelId: 'c1' }],
      () => 'general',
    );
    expect(parseMessageWithMentions(text, [], channels)).toEqual([
      { type: SpanType.CHANNEL_MENTION, channelId: 'c1' },
    ]);
  });

  it('creates PLAINTEXT span for unresolved @unknown mention', () => {
    const spans = parseMessageWithMentions('@unknown');
    expect(spans).toEqual([{ type: SpanType.PLAINTEXT, text: '@unknown' }]);
  });

  it('produces correct span sequence for mixed text and mentions', () => {
    const users = [{ id: 'u1', username: 'user' }];
    const spans = parseMessageWithMentions('hello @user world', users);
    expect(spans).toEqual([
      { type: SpanType.PLAINTEXT, text: 'hello ' },
      { type: SpanType.USER_MENTION, text: '@user', userId: 'u1' },
      { type: SpanType.PLAINTEXT, text: ' world' },
    ]);
  });
});

describe('spansToText', () => {
  it('converts spans back to concatenated text', () => {
    const text = spansToText([
      { type: SpanType.PLAINTEXT, text: 'hello ' },
      { type: SpanType.USER_MENTION, text: '@alice' },
      { type: SpanType.PLAINTEXT, text: ' world' },
    ]);
    expect(text).toBe('hello @alice world');
  });

  it('returns empty string for empty spans array', () => {
    expect(spansToText([])).toBe('');
  });
});

describe('getCurrentMention', () => {
  it('returns mention info when cursor is after @ with query text', () => {
    const result = getCurrentMention('hello @ali', 10);
    expect(result).toEqual({
      type: 'user',
      query: 'ali',
      start: 6,
      end: 10,
    });
  });

  it('returns channel mention info when cursor is after #', () => {
    const result = getCurrentMention('go to #gen', 10);
    expect(result).toEqual({
      type: 'channel',
      query: 'gen',
      start: 6,
      end: 10,
    });
  });

  it('returns null when no mention at cursor position', () => {
    const result = getCurrentMention('hello world', 5);
    expect(result).toBeNull();
  });
});

describe('insertMention', () => {
  it('replaces partial mention with resolved user mention and adds trailing space', () => {
    const { newText, newCursorPosition } = insertMention(
      'hello @ali',
      10,
      { type: 'user', username: 'alice' },
    );
    expect(newText).toBe('hello @alice ');
    expect(newCursorPosition).toBe(13);
  });

  it('inserts at cursor position when no current mention', () => {
    // cursor at position 6 (after "hello "), no @ prefix so no current mention detected
    const { newText, newCursorPosition } = insertMention(
      'hello world',
      6,
      { type: 'user', username: 'alice' },
    );
    // Inserts "@alice " at position 6
    expect(newText).toBe('hello @alice world');
    expect(newCursorPosition).toBe(13);
  });
});

describe('resolveMentionText', () => {
  it('returns @displayName when USER_MENTION matches a user with displayName', () => {
    const users = [{ id: 'u1', username: 'alice', displayName: 'Alice W' }];
    const result = resolveMentionText(
      { type: SpanType.USER_MENTION, text: '@alice', userId: 'u1' },
      users,
    );
    expect(result).toBe('@Alice W');
  });

  it('returns @username when USER_MENTION matches a user without displayName', () => {
    const users = [{ id: 'u1', username: 'alice' }];
    const result = resolveMentionText(
      { type: SpanType.USER_MENTION, text: '@alice', userId: 'u1' },
      users,
    );
    expect(result).toBe('@alice');
  });

  it('returns span text for PLAINTEXT span', () => {
    const result = resolveMentionText(
      { type: SpanType.PLAINTEXT, text: 'hello world' },
    );
    expect(result).toBe('hello world');
  });
});

describe('parseMessageWithMentions - rich text formatting', () => {
  it('parses **bold**', () => {
    expect(parseMessageWithMentions('**hi**')).toEqual([
      { type: SpanType.PLAINTEXT, text: 'hi', bold: true },
    ]);
  });

  it('parses *italic* and _italic_', () => {
    expect(parseMessageWithMentions('*hi*')).toEqual([
      { type: SpanType.PLAINTEXT, text: 'hi', italic: true },
    ]);
    expect(parseMessageWithMentions('_hi_')).toEqual([
      { type: SpanType.PLAINTEXT, text: 'hi', italic: true },
    ]);
  });

  it('parses ~~strikethrough~~', () => {
    expect(parseMessageWithMentions('~~hi~~')).toEqual([
      { type: SpanType.PLAINTEXT, text: 'hi', strikethrough: true },
    ]);
  });

  it('parses inline `code` verbatim without inner parsing', () => {
    expect(parseMessageWithMentions('`a *b* @c`')).toEqual([
      { type: SpanType.PLAINTEXT, text: 'a *b* @c', code: true },
    ]);
  });

  it('composes bold + italic (**_x_**)', () => {
    expect(parseMessageWithMentions('**_hi_**')).toEqual([
      { type: SpanType.PLAINTEXT, text: 'hi', bold: true, italic: true },
    ]);
  });

  it('keeps surrounding plaintext (and its spacing) around a formatted run', () => {
    expect(parseMessageWithMentions('a **b** c')).toEqual([
      { type: SpanType.PLAINTEXT, text: 'a ' },
      { type: SpanType.PLAINTEXT, text: 'b', bold: true },
      { type: SpanType.PLAINTEXT, text: ' c' },
    ]);
  });

  it('resolves a mention inside a bold run', () => {
    const users = [{ id: 'u1', username: 'alice' }];
    expect(parseMessageWithMentions('**@alice**', users)).toEqual([
      { type: SpanType.USER_MENTION, text: '@alice', userId: 'u1' },
    ]);
  });

  it('does not treat underscores in snake_case as italic', () => {
    expect(parseMessageWithMentions('call foo_bar_baz now')).toEqual([
      { type: SpanType.PLAINTEXT, text: 'call foo_bar_baz now' },
    ]);
  });

  it('leaves a lone asterisk as literal text', () => {
    expect(parseMessageWithMentions('2 * 3 = 6')).toEqual([
      { type: SpanType.PLAINTEXT, text: '2 * 3 = 6' },
    ]);
  });

  it('does not parse mentions or formatting inside inline code', () => {
    const users = [{ id: 'u1', username: 'alice' }];
    expect(parseMessageWithMentions('`@alice **x**`', users)).toEqual([
      { type: SpanType.PLAINTEXT, text: '@alice **x**', code: true },
    ]);
  });

  it('does not auto-link URLs inside inline code (code is verbatim)', () => {
    expect(parseMessageWithMentions('`https://example.com`')).toEqual([
      { type: SpanType.PLAINTEXT, text: 'https://example.com', code: true },
    ]);
  });

  it('parses a fenced code block into a CODE_BLOCK span', () => {
    expect(parseMessageWithMentions('```\nconst x = 1;\n```')).toEqual([
      { type: SpanType.CODE_BLOCK, text: 'const x = 1;' },
    ]);
  });

  it('strips the language line from a fenced code block', () => {
    expect(parseMessageWithMentions('```js\nconst x = 1;\n```')).toEqual([
      { type: SpanType.CODE_BLOCK, text: 'const x = 1;' },
    ]);
  });

  it('preserves a multi-line code block body', () => {
    expect(parseMessageWithMentions('```\nline1\nline2\n```')).toEqual([
      { type: SpanType.CODE_BLOCK, text: 'line1\nline2' },
    ]);
  });

  it('does not parse formatting or mentions inside a code block', () => {
    const users = [{ id: 'u1', username: 'alice' }];
    expect(parseMessageWithMentions('```\n**bold** @alice\n```', users)).toEqual([
      { type: SpanType.CODE_BLOCK, text: '**bold** @alice' },
    ]);
  });

  it('mixes plaintext before and after a fenced code block', () => {
    expect(parseMessageWithMentions('see:\n```\ncode\n```\ndone')).toEqual([
      { type: SpanType.PLAINTEXT, text: 'see:\n' },
      { type: SpanType.CODE_BLOCK, text: 'code' },
      { type: SpanType.PLAINTEXT, text: '\ndone' },
    ]);
  });
});

describe('spansToText - formatting round-trip', () => {
  it('re-adds bold markers', () => {
    expect(
      spansToText([{ type: SpanType.PLAINTEXT, text: 'hi', bold: true }]),
    ).toBe('**hi**');
  });

  it('re-adds combined bold+italic as **_x_**', () => {
    expect(
      spansToText([
        { type: SpanType.PLAINTEXT, text: 'hi', bold: true, italic: true },
      ]),
    ).toBe('**_hi_**');
  });

  it('re-adds inline code markers verbatim (no other wrapping)', () => {
    expect(
      spansToText([{ type: SpanType.PLAINTEXT, text: 'x = 1', code: true }]),
    ).toBe('`x = 1`');
  });

  it('re-fences a CODE_BLOCK span', () => {
    expect(spansToText([{ type: SpanType.CODE_BLOCK, text: 'code' }])).toBe(
      '```\ncode\n```',
    );
  });

  it('round-trips bold+italic through parse -> text -> parse', () => {
    const original = [
      { type: SpanType.PLAINTEXT, text: 'x', bold: true, italic: true },
    ];
    expect(parseMessageWithMentions(spansToText(original))).toEqual(original);
  });
});

describe('parseMessageWithMentions custom emojis', () => {
  const emojis = [
    { id: 'e1', name: 'party_blob' },
    { id: 'e2', name: 'cat_jam' },
  ];

  it('resolves a known :shortcode: to an EMOJI span', () => {
    const result = parseMessageWithMentions('hi :party_blob:', [], [], [], emojis);
    expect(result).toEqual([
      { type: SpanType.PLAINTEXT, text: 'hi ' },
      { type: SpanType.EMOJI, text: ':party_blob:', emojiId: 'e1' },
    ]);
  });

  it('leaves an unknown :shortcode: as literal plaintext', () => {
    const result = parseMessageWithMentions('hi :unknown_emoji:', [], [], [], emojis);
    expect(result).toEqual([
      { type: SpanType.PLAINTEXT, text: 'hi :unknown_emoji:' },
    ]);
  });

  it('does not resolve emojis inside inline code', () => {
    const result = parseMessageWithMentions('`:party_blob:`', [], [], [], emojis);
    expect(result).toEqual([
      { type: SpanType.PLAINTEXT, text: ':party_blob:', code: true },
    ]);
  });

  it('does not resolve emojis inside a fenced code block', () => {
    const result = parseMessageWithMentions('```\n:party_blob:\n```', [], [], [], emojis);
    expect(result).toEqual([
      { type: SpanType.CODE_BLOCK, text: ':party_blob:' },
    ]);
  });

  it('resolves multiple emojis interleaved with mentions', () => {
    const users = [{ id: 'u1', username: 'alice' }];
    const result = parseMessageWithMentions(
      ':party_blob: @alice :cat_jam:',
      users,
      [],
      [],
      emojis,
    );
    expect(result).toEqual([
      { type: SpanType.EMOJI, text: ':party_blob:', emojiId: 'e1' },
      { type: SpanType.PLAINTEXT, text: ' ' },
      { type: SpanType.USER_MENTION, text: '@alice', userId: 'u1' },
      { type: SpanType.PLAINTEXT, text: ' ' },
      { type: SpanType.EMOJI, text: ':cat_jam:', emojiId: 'e2' },
    ]);
  });

  it('round-trips an EMOJI span back to its :shortcode:', () => {
    const spans = parseMessageWithMentions('yo :party_blob:', [], [], [], emojis);
    expect(spansToText(spans)).toBe('yo :party_blob:');
  });
});
