/**
 * Exports vectors for the native message-text module (unit U6).
 *
 * Run with `native/scripts/export-web.sh text`; it writes `native-export-out/text/<fn>.json`,
 * which `scripts/gen-text.sh` copies to `native/fixtures/text/`.
 *
 * Every `expected` is produced by running the web client's own function on `input`, so the
 * vectors are what the web does, not what a person believes it does. The inputs are the cases
 * from `mentionParser.test.ts` and `richTextShortcuts.test.ts`, plus edge cases, plus a seeded
 * pseudo-random corpus of marker/mention/code/URL soup for `parse`.
 *
 * Offsets (`start`, `end`, cursors, selections) are UTF-16 units on the web and bytes in Rust,
 * so inputs to the offset-returning functions are ASCII. The auto-link rule is not exported by
 * `MessageSpan.tsx` (it lives inside the component), so `linkParts` restates its two lines
 * verbatim below, and `extractUrls` restates `backend/src/link-previews/link-preview.utils.ts`.
 * Keep both in step with those files.
 */
import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  findMentions,
  getCodeRegions,
  parseMessageWithMentions,
  spansToText,
  getCurrentMention,
  insertMention,
  resolveMentionText,
} from '../../utils/mentionParser';
import { wrapSelection, markerForShortcut } from '../../utils/richTextShortcuts';
import type { Span } from '../../types/message.type';

type Json = Record<string, unknown>;
interface Vec {
  name: string;
  input: unknown;
  expected: unknown;
}

const alice = { id: 'u1', username: 'alice', displayName: 'Alice W' };
const bob = { id: 'u2', username: 'Bob' };
const general = { id: 'c1', name: 'general' };
const dev = { id: 'c2', name: 'Dev-Talk' };
const devs = { id: 'a1', name: 'devs' };
const emojis = [
  { id: 'e1', name: 'party_blob' },
  { id: 'e2', name: 'cat_jam' },
];

// --- parse -------------------------------------------------------------------------------
interface ParseIn {
  text: string;
  users?: unknown[];
  channels?: unknown[];
  aliases?: unknown[];
  emojis?: unknown[];
}
const parseCases: [string, ParseIn][] = [
  ['plain', { text: 'hello world' }],
  ['empty', { text: '' }],
  ['user mention', { text: '@alice', users: [alice] }],
  ['user mention case-insensitive', { text: '@ALICE and @bob', users: [alice, bob] }],
  ['alias wins over user', { text: '@devs', users: [{ id: 'u1', username: 'devs' }], aliases: [devs] }],
  ['special here', { text: '@here' }],
  ['special channel', { text: 'ping @channel now' }],
  ['channel mention', { text: '#general', channels: [general] }],
  ['channel mention case-insensitive', { text: 'in #dev-talk please', channels: [dev] }],
  ['unresolved user', { text: '@unknown' }],
  ['unresolved channel', { text: '#nowhere' }],
  ['mixed', { text: 'hello @alice world', users: [alice] }],
  ['mention at end with punctuation', { text: 'hi @alice, #general!', users: [alice], channels: [general] }],
  ['email-like', { text: 'mail me@alice.com', users: [alice] }],
  ['bold', { text: '**hi**' }],
  ['italic star', { text: '*hi*' }],
  ['italic underscore', { text: '_hi_' }],
  ['strike', { text: '~~hi~~' }],
  ['inline code verbatim', { text: '`a *b* @c`' }],
  ['bold italic', { text: '**_hi_**' }],
  ['italic bold', { text: '_**hi**_' }],
  ['surrounding spaces kept', { text: 'a **b** c' }],
  ['mention in bold', { text: '**@alice**', users: [alice] }],
  ['snake_case', { text: 'call foo_bar_baz now' }],
  ['lone asterisk', { text: '2 * 3 = 6' }],
  ['unclosed bold', { text: '**hi' }],
  ['empty pair', { text: '****' }],
  ['empty underscore pair', { text: '__' }],
  ['nested same style', { text: '**a **b** c**' }],
  ['bold inside bold uses italic quirk', { text: '**a *b* c**' }],
  ['code in bold', { text: '**a `b` c**' }],
  ['code not mention', { text: '`@alice **x**`', users: [alice] }],
  ['code not link', { text: '`https://example.com`' }],
  ['unclosed backtick', { text: 'a ` b' }],
  ['empty backticks', { text: 'a `` b' }],
  ['fenced', { text: '```\nconst x = 1;\n```' }],
  ['fenced lang', { text: '```js\nconst x = 1;\n```' }],
  ['fenced multiline', { text: '```\nline1\nline2\n```' }],
  ['fenced no newline', { text: '```code```' }],
  ['fenced prose first line', { text: '```hello world\ncode\n```' }],
  ['fenced blank first line spaces', { text: '```  \ncode\n```' }],
  ['fenced two trailing newlines', { text: '```\ncode\n\n```' }],
  ['fenced crlf', { text: '```\r\ncode\r\n```' }],
  ['fenced content untouched', { text: '```\n**bold** @alice\n```', users: [alice] }],
  ['fenced between text', { text: 'see:\n```\ncode\n```\ndone' }],
  ['two fenced blocks', { text: '```a\n1\n```mid```b\n2\n```' }],
  ['unclosed fence', { text: '```\ncode' }],
  ['four backticks', { text: '````' }],
  ['emoji known', { text: 'hi :party_blob:', emojis }],
  ['emoji unknown', { text: 'hi :unknown_emoji:', emojis }],
  ['emoji in code', { text: '`:party_blob:`', emojis }],
  ['emoji in fence', { text: '```\n:party_blob:\n```', emojis }],
  ['emoji and mention', { text: ':party_blob: @alice :cat_jam:', users: [alice], emojis }],
  ['emoji adjacent', { text: ':cat_jam::cat_jam:', emojis }],
  ['emoji too short', { text: ':a:', emojis: [{ id: 'e', name: 'a' }] }],
  ['emoji ignored without list', { text: ':party_blob:' }],
  ['emoji in bold', { text: '**:cat_jam:**', emojis }],
  ['non-ascii text', { text: 'héllo **wörld** 日本語 @alice 🎉', users: [alice] }],
  ['non-ascii around underscore', { text: 'é_x_ and _é_', users: [] }],
  ['url stays plaintext', { text: 'see https://example.com/a_b_c now' }],
  ['newlines', { text: 'a\n**b**\nc' }],
];

// --- the seeded corpus -------------------------------------------------------------------
const soup = [
  'a', 'b', ' ', '\n', '_', '*', '**', '~~', '`', '```', '@alice', '@here', '@x', '#general', '#zz',
  ':cat_jam:', ':nope:', 'http://x.y.', 'é', '__', 'foo_bar',
];
let seed = 20260922;
const rand = (n: number) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % n;
};
for (let i = 0; i < 500; i++) {
  const len = 2 + rand(7);
  let text = '';
  for (let j = 0; j < len; j++) text += soup[rand(soup.length)];
  parseCases.push([
    `soup ${i}`,
    { text, users: [alice], channels: [general], aliases: [devs], emojis },
  ]);
}

// --- the rest ----------------------------------------------------------------------------
const findCases = [
  'hello @alice', '@here and @channel', 'go to #general', '@bob check #dev and @alice', 'just some plain text', '',
  '@my-user and @my_user', 'use `@alice` in code', '```\n@alice\n```', 'type `#general` to reference',
  '@bob said `@alice` is great', '```js\n@alice\n```', '@a@b', 'x@y.z', '#a#b', '@-x', '@_x', '@', '#', '@@alice',
  '@alice-', 'a `` @alice', '`unclosed @alice', '@alice `x` #dev ```y @q``` @z',
];
const codeCases = [
  'hello `code` world', 'before ```\ncode\n``` after', 'no code here', '``````', '```', '``', '`a``b`', '```a``` `b`', '',
  'a ```\nunclosed', '`a\nb`', '````x````',
];
const spanCases: { name: string; spans: Span[]; channels: Record<string, string> | null }[] = [
  { name: 'concatenates', channels: null, spans: [
    { type: 'PLAINTEXT', text: 'hello ' }, { type: 'USER_MENTION', text: '@alice' }, { type: 'PLAINTEXT', text: ' world' },
  ] as Span[] },
  { name: 'empty', channels: null, spans: [] },
  { name: 'channel names', channels: { c1: 'general' }, spans: [
    { type: 'CHANNEL_MENTION', channelId: 'c1' }, { type: 'PLAINTEXT', text: ' and ' }, { type: 'CHANNEL_MENTION', channelId: 'hidden' },
  ] as Span[] },
  { name: 'channel names absent', channels: null, spans: [
    { type: 'CHANNEL_MENTION', channelId: 'c1' }, { type: 'PLAINTEXT', text: ' and ' }, { type: 'CHANNEL_MENTION', channelId: 'hidden' },
  ] as Span[] },
  { name: 'channel with empty name', channels: { c1: '' }, spans: [{ type: 'CHANNEL_MENTION', channelId: 'c1' }] as Span[] },
  { name: 'channel with no id', channels: null, spans: [{ type: 'CHANNEL_MENTION' }] as Span[] },
  { name: 'bold', channels: null, spans: [{ type: 'PLAINTEXT', text: 'hi', bold: true }] as Span[] },
  { name: 'bold italic', channels: null, spans: [{ type: 'PLAINTEXT', text: 'hi', bold: true, italic: true }] as Span[] },
  { name: 'all styles', channels: null, spans: [{ type: 'PLAINTEXT', text: 'hi', bold: true, italic: true, strikethrough: true }] as Span[] },
  { name: 'strike', channels: null, spans: [{ type: 'PLAINTEXT', text: 'hi', strikethrough: true }] as Span[] },
  { name: 'inline code beats styles', channels: null, spans: [{ type: 'PLAINTEXT', text: 'x = 1', code: true, bold: true }] as Span[] },
  { name: 'code block', channels: null, spans: [{ type: 'CODE_BLOCK', text: 'code' }] as Span[] },
  { name: 'code block no text', channels: null, spans: [{ type: 'CODE_BLOCK' }] as Span[] },
  { name: 'emoji', channels: null, spans: [{ type: 'EMOJI', text: ':party_blob:', emojiId: 'e1' }] as Span[] },
  { name: 'user mention no text', channels: null, spans: [{ type: 'USER_MENTION', userId: 'u1' }] as Span[] },
  { name: 'special with text', channels: null, spans: [{ type: 'SPECIAL_MENTION', text: '@here', specialKind: 'here' }] as Span[] },
  { name: 'community and alias', channels: null, spans: [
    { type: 'COMMUNITY_MENTION', text: '@acme' }, { type: 'COMMUNITY_MENTION' }, { type: 'ALIAS_MENTION', text: '@devs' }, { type: 'ALIAS_MENTION' },
  ] as Span[] },
  { name: 'plaintext no text', channels: null, spans: [{ type: 'PLAINTEXT' }] as Span[] },
  { name: 'unknown type renders text', channels: null, spans: [{ type: 'HOLOGRAM', text: 'there' }] as unknown as Span[] },
  { name: 'emoji round trip', channels: null, spans: parseMessageWithMentions('yo :party_blob:', [], [], [], emojis) },
  { name: 'bold italic round trip', channels: null, spans: [{ type: 'PLAINTEXT', text: 'x', bold: true, italic: true }] as Span[] },
];
const currentCases: [string, number][] = [
  ['hello @ali', 10], ['go to #gen', 10], ['hello world', 5], ['hello @', 7], ['#', 1], ['@here', 5], ['@channel', 8], ['@channel', 4],
  ['a@b', 3], ['a@b', 2], ['@a b', 4], ['@a-b_c', 6], ['x #', 3], ['hello @ali there', 10], ['', 0], ['@x', 0], ['ab', 2], ['@@x', 3],
  ['a#b@c', 5],
];
const insertCases: [string, number, Json][] = [
  ['hello @ali', 10, { type: 'user', username: 'alice' }],
  ['hello world', 6, { type: 'user', username: 'alice' }],
  ['hello @', 7, { type: 'special', specialKind: 'here' }],
  ['go #ge', 6, { type: 'channel', channelName: 'general' }],
  ['go #', 4, { type: 'channel', channelName: 'dev-talk' }],
  ['hi @de there', 6, { type: 'alias', aliasName: 'devs' }],
  ['', 0, { type: 'user', username: 'bob' }],
  ['abc', 3, { type: 'channel', channelName: 'x' }],
  ['abc', 0, { type: 'special', specialKind: 'channel' }],
  ['x @al y', 5, { type: 'user', username: 'alice' }],
  ['@a @b', 5, { type: 'alias', aliasName: 'grp' }],
];
const resolveCases: [string, Json, unknown[]][] = [
  ['display name', { type: 'USER_MENTION', text: '@alice', userId: 'u1' }, [alice]],
  ['username only', { type: 'USER_MENTION', text: '@alice', userId: 'u1' }, [{ id: 'u1', username: 'alice' }]],
  ['plaintext', { type: 'PLAINTEXT', text: 'hello world' }, []],
  ['plaintext no text', { type: 'PLAINTEXT' }, []],
  ['user not found uses text', { type: 'USER_MENTION', text: '@ghost', userId: 'zz' }, [alice]],
  ['user no text no match', { type: 'USER_MENTION', userId: 'zz' }, []],
  ['user no id', { type: 'USER_MENTION', text: '@t' }, [alice]],
  ['special with text', { type: 'SPECIAL_MENTION', text: '@here', specialKind: 'here' }, []],
  ['special no text', { type: 'SPECIAL_MENTION', specialKind: 'channel' }, []],
  ['other type', { type: 'CODE_BLOCK', text: 'x' }, []],
];
const wrapCases: [string, number, number, string][] = [
  ['abc', 1, 2, '**'], ['ab', 1, 1, '**'], ['a**b**c', 3, 4, '**'], ['a**b**c', 1, 6, '**'], ['abc', 0, 3, '_'], ['_abc_', 1, 4, '_'],
  ['_abc_', 0, 5, '_'], ['', 0, 0, '_'], ['a****b', 3, 3, '**'], ['****', 0, 4, '**'], ['**', 0, 2, '**'], ['x _y_ z', 3, 4, '_'],
  ['hello world', 6, 11, '**'], ['a**b', 1, 4, '**'], ['**a', 0, 3, '**'], ['abc', 3, 3, '_'],
];
const keyCases = ['b', 'B', 'i', 'I', 'x', '', 'bold', 'Enter', ' '];
const linkCases = [
  'see https://example.com now', 'https://a.b', 'http://a.b.', 'trailing, https://x.y/z?q=1!', 'wrapped (https://x.y)', 'no links here', '',
  'http://', 'http://.', 'https://.', 'ftp://x.y', 'javascript:alert(1)', 'HTTP://X.Y', 'a http://x.y b https://z.w c', 'http://a.b/c.d.e,',
  '<https://x.y>', '"https://x.y"', "it's https://x.y/it's", 'https://x.y/a b', 'http://http://x', 'https://a.b?c=d;', 'xhttps://a.b',
  'https://a.b\nhttps://c.d', 'https://é.com/ü', 'http://x.y.http://z.w', 'https://x:', 'https://x.', 'see http://. and https://ok.io', 'file:///etc/passwd',
  'https://a.b c', 'https://a.b c', 'https://a.b﻿c',
];
const extractCases = [
  'one https://a.b two', 'https://a.b https://a.b https://c.d', 'none', '',
  'https://1.a https://2.b https://3.c https://4.d https://5.e https://6.f https://7.g',
  'https://a.b. https://a.b', 'http://x.y, ftp://z.w',
];

const URL_PATTERN = /(https?:\/\/[^\s<>)"']*[^\s<>)"'.,!?;:])/g; // MessageSpan.tsx and link-preview.utils.ts
function linkParts(text: string) {
  // Verbatim from MessageSpan.tsx: split, then test every part (not only the captures).
  return text
    .split(URL_PATTERN)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, link: /^https?:\/\//.test(part) }));
}
function extractUrls(text: string): string[] {
  // Verbatim from link-preview.utils.ts, MAX_URLS_PER_MESSAGE = 5.
  const matches = text.match(URL_PATTERN);
  if (!matches) return [];
  return [...new Set(matches)].slice(0, 5);
}

const toMap = (c: Record<string, string> | null) => (c ? new Map(Object.entries(c)) : null);

const out: Record<string, Vec[]> = {
  parse: parseCases.map(([name, input]) => ({
    name,
    input: { users: [], channels: [], aliases: [], emojis: [], ...input },
    expected: parseMessageWithMentions(
      input.text,
      (input.users ?? []) as never[],
      (input.channels ?? []) as never[],
      (input.aliases ?? []) as never[],
      (input.emojis ?? []) as never[],
    ),
  })),
  find_mentions: findCases.map((text) => ({ name: text, input: { text }, expected: findMentions(text) })),
  code_regions: codeCases.map((text) => ({ name: text, input: { text }, expected: getCodeRegions(text) })),
  spans_to_text: spanCases.map(({ name, spans, channels }) => {
    const map = toMap(channels);
    return {
      name,
      input: { spans, channels },
      expected: spansToText(spans, map ? (id: string) => map.get(id) : undefined),
    };
  }),
  current_mention: currentCases.map(([text, cursor]) => ({
    name: `${text}@${cursor}`,
    input: { text, cursor },
    expected: getCurrentMention(text, cursor),
  })),
  insert_mention: insertCases.map(([text, cursor, mention]) => ({
    name: `${text}@${cursor}`,
    input: { text, cursor, mention },
    expected: insertMention(text, cursor, mention as never),
  })),
  resolve_mention_text: resolveCases.map(([name, span, users]) => ({
    name,
    input: { span, users },
    expected: resolveMentionText(span as never, users as never[]),
  })),
  wrap_selection: wrapCases.map(([text, start, end, marker]) => ({
    name: `${text} ${start}..${end} ${marker}`,
    input: { text, start, end, marker },
    expected: wrapSelection(text, start, end, marker),
  })),
  marker_for_shortcut: keyCases.map((key) => ({ name: key, input: { key }, expected: markerForShortcut(key) })),
  link_parts: linkCases.map((text) => ({ name: text, input: { text }, expected: linkParts(text) })),
  extract_urls: extractCases.map((text) => ({ name: text, input: { text }, expected: extractUrls(text) })),
};

it('exports the text vectors', () => {
  mkdirSync('native-export-out/text', { recursive: true });
  for (const [name, vectors] of Object.entries(out)) {
    writeFileSync(`native-export-out/text/${name}.json`, '[\n' + vectors.map((v) => JSON.stringify(v)).join(',\n') + '\n]\n');
  }
});
