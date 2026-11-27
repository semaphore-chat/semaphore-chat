import { MessageText, Stack, type MessageSegment } from '../../kit';
import { ChatColumn, OnPalette } from './kitChatFixtures';
import { PALETTES, PARROT_SRC, noop } from './kitChatData';

const EVERY: MessageSegment[][] = [
  [
    { type: 'text', text: 'plain, ' },
    { type: 'text', text: 'bold', bold: true },
    { type: 'text', text: ', ' },
    { type: 'text', text: 'italic', italic: true },
    { type: 'text', text: ', ' },
    { type: 'text', text: 'struck', strike: true },
    { type: 'text', text: ', ' },
    { type: 'text', text: 'all three', bold: true, italic: true, strike: true },
    { type: 'text', text: ' and ' },
    { type: 'code', text: 'inline code' },
  ],
  [
    { type: 'text', text: 'mentions: ' },
    { type: 'mention', kind: 'user', text: '@aiko', id: 'u1' },
    { type: 'text', text: ' ' },
    { type: 'mention', kind: 'user', text: '@alexk', id: 'me', me: true },
    { type: 'text', text: ' ' },
    { type: 'mention', kind: 'role', text: '@mods', id: 'r1' },
    { type: 'text', text: ' ' },
    { type: 'mention', kind: 'everyone', text: '@everyone', me: true },
    { type: 'text', text: ' ' },
    { type: 'mention', kind: 'channel', text: '#clips', id: 'c1', href: '#/c/clips' },
    { type: 'text', text: ' ' },
    { type: 'mention', kind: 'channel', text: '#private-channel', unavailable: true },
  ],
  [
    { type: 'text', text: 'a link: ' },
    { type: 'link', href: 'https://docs.semaphorechat.app' },
    { type: 'text', text: ', and an unsafe one drawn as text: ' },
    { type: 'link', href: 'javascript:alert(1)' },
  ],
  [
    { type: 'text', text: 'formatted links keep the span: ', bold: true },
    { type: 'link', href: 'https://docs.semaphorechat.app/guide', bold: true },
    { type: 'text', text: ', ' },
    { type: 'link', href: 'https://example.com/italic', italic: true },
    { type: 'text', text: ', ' },
    { type: 'link', href: 'https://example.com/gone', strike: true },
  ],
  [
    { type: 'text', text: 'a lookalike host shows as punycode: ' },
    { type: 'link', href: 'https://\u0430pple.com/login' },
    { type: 'text', text: '; a right-to-left override stays encoded: ' },
    { type: 'link', href: 'https://example.com/\u202Egnp.exe' },
    { type: 'text', text: '; so do spaces: ' },
    { type: 'link', href: 'https://evil.example/%20%20%20https://bank.example/login' },
    { type: 'text', text: '; a user name in the address is not a link: ' },
    { type: 'link', href: 'https://aaaaaaaaaaaa.bank.example@evil.example/login' },
  ],
  [
    { type: 'text', text: 'a mention whose address leaves the app is not a link: ' },
    { type: 'mention', kind: 'channel', text: '#elsewhere', id: 'c9', href: '//evil.example/c' },
  ],
  [
    { type: 'text', text: 'custom emoji ' },
    { type: 'emoji', name: 'partyparrot', src: PARROT_SRC },
    { type: 'text', text: ' and one with no image ' },
    { type: 'emoji', name: 'gone' },
  ],
  [
    { type: 'text', text: 'a code block:' },
    { type: 'codeBlock', text: 'const answer = 42;\nconsole.log(answer);' },
  ],
  [{ type: 'text', text: 'line one\nline two, kept as written\n\nand a gap' }],
];

const LONG_LINK: MessageSegment[] = [
  { type: 'text', text: 'a very long link: ' },
  {
    type: 'link',
    href: 'https://example.com/a/very/long/path/that/goes/on/and/on/and/never/breaks/naturally/because/it/has/no/spaces/at/all?with=query&and=more&params=than&anyone=needs',
  },
];

const RTL: MessageSegment[] = [
  { type: 'text', text: 'مرحبا بالجميع، هل نلعب الليلة؟ ' },
  { type: 'mention', kind: 'user', text: '@سارة', id: 'u5' },
];

// Bidi controls in the words before a link or a mention: the label and the mention still draw left to right, as written.
const ISOLATED: MessageSegment[] = [
  { type: 'text', text: 'مرحبا، pay at \u202E' },
  { type: 'link', href: 'https://docs.semaphorechat.app/guide' },
  { type: 'text', text: ' \u202Etoday \u2067ask\u2069 ' },
  { type: 'mention', kind: 'user', text: '@aiko', id: 'u1' },
  { type: 'text', text: ' \u200Fشكرا' },
];

const EMOJI_ONLY: MessageSegment[][] = [
  [{ type: 'text', text: '😂🔥👍' }],
  [
    { type: 'emoji', name: 'partyparrot', src: PARROT_SRC },
    { type: 'emoji', name: 'partyparrot', src: PARROT_SRC },
  ],
];

const Body = () => (
  <ChatColumn>
    <div style={{ padding: '0 16px' }}>
      <Stack gap="md">
        {EVERY.map((segments, index) => (
          <MessageText key={index} segments={segments} onMention={noop} />
        ))}
        <MessageText segments={LONG_LINK} />
        <MessageText segments={RTL} onMention={noop} />
        <MessageText segments={ISOLATED} onMention={noop} />
        {EMOJI_ONLY.map((segments, index) => (
          <MessageText key={`e${index}`} segments={segments} />
        ))}
      </Stack>
    </div>
  </ChatColumn>
);

/**
 * Every segment type, formatted links, a lookalike host (punycode), a bidi override and spaces (kept encoded), an
 * address with a user name (text, not a link), a mention with an outside address (not a link), a long link,
 * right-to-left text, an override before a link and a mention (both draw left to right) and emoji-only messages (text size, as classic).
 */
export const Segments = () => (
  <OnPalette palette={PALETTES[0]}>
    <Body />
  </OnPalette>
);

export const SegmentsLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <Body />
  </OnPalette>
);

export const SegmentsTinted = () => (
  <OnPalette palette={PALETTES[2]}>
    <Body />
  </OnPalette>
);
