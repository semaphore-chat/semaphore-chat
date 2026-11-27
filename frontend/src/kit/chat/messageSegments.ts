/**
 * What `MessageText` draws: a message's words, already parsed. The kit only renders these; turning a message's
 * stored spans into segments (`toSegments(spans)`) is the chat data layer's job, so this file has no parser.
 *
 * Segments are inline and drawn in order, except `codeBlock`, which is a block of its own.
 */

/** The inline formatting a run of words can carry. A link inside a formatted span keeps it (`**see https://x.y**`). */
export interface SegmentStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
}

/** Words, with the inline formatting a message can carry. Line breaks in `text` are kept. */
export interface TextSegment extends SegmentStyle {
  type: 'text';
  text: string;
}

/** Inline code: drawn verbatim in the code font. */
export interface CodeSegment {
  type: 'code';
  text: string;
}

/** A fenced block of code, on its own lines. Long lines wrap. */
export interface CodeBlockSegment {
  type: 'codeBlock';
  text: string;
}

/**
 * A web link, shown as its own address (there are no masked links: what you see is where it goes). It opens in a
 * new tab. Only `http:` and `https:` links without a user name or password are links: anything else
 * (`javascript:`, `data:`, `https://bank.example@evil.example/`) is drawn as its text, never as a link. The
 * address shown is the parsed one, never decoded: a non-ASCII host reads as punycode (`xn--pple-43d.com`, not a
 * lookalike `аpple.com`), and a space, an invisible character or a bidi control in the path stays `%xx`.
 */
export interface LinkSegment extends SegmentStyle {
  type: 'link';
  href: string;
}

/** Who or what a mention points at. `everyone` covers `@everyone` and `@here`. */
export type MentionKind = 'user' | 'role' | 'channel' | 'everyone';

/**
 * A mention, shown as written (`@aiko`, `#clips`, `@mods`). A user mention with `MessageText`'s `onMention` is a
 * button; a mention with `href` (a channel) is a link; any other is plain marked text.
 */
export interface MentionSegment {
  type: 'mention';
  kind: MentionKind;
  /** The visible text, with its sign: `@aiko`, `#clips`. */
  text: string;
  /** The id of the user, role or channel, handed back to `onMention`. */
  id?: string;
  /**
   * Where a channel mention goes: an app-internal address only, a hash route (`#/c/clips`) or a path with one
   * leading slash (`/c/clips`). Anything else (`//host`, `data:`, `https:`) is not followed: the mention is drawn
   * as text.
   */
  href?: string;
  /** It mentions the reader (their name, a role they hold, or everyone): drawn in the solid accent. */
  me?: boolean;
  /** The reader cannot open it (a channel they cannot see): dimmed and not interactive. */
  unavailable?: boolean;
}

/** A community's custom emoji. Without `src`, or when the image fails, its `:name:` is shown. */
export interface EmojiSegment {
  type: 'emoji';
  /** The short name, without colons: `partyparrot`. */
  name: string;
  src?: string;
}

export type MessageSegment =
  | TextSegment
  | CodeSegment
  | CodeBlockSegment
  | LinkSegment
  | MentionSegment
  | EmojiSegment;

/** Bidi controls (embeddings, overrides, isolates, marks): they reorder what is drawn, so a shown address drops them. */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** `text` without bidi control characters. */
export function stripBidi(text: string): string {
  return text.replace(BIDI_CONTROLS, '');
}

/** Bidi embeddings, overrides and isolates. The plain marks (U+200E, U+200F, U+061C) are not here: they are harmless. */
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/g;

/** `text` without bidi embeddings, overrides and isolates, so none can reach past its own segment. Marks are kept. */
export function stripBidiOverrides(text: string): string {
  return text.replace(BIDI_OVERRIDES, '');
}

/** The segments with bidi overrides dropped from every text, code and code-block run (and a mention's text). */
export function cleanSegments(segments: readonly MessageSegment[]): MessageSegment[] {
  return segments.map((segment) =>
    segment.type === 'text' || segment.type === 'code' || segment.type === 'codeBlock' || segment.type === 'mention'
      ? { ...segment, text: stripBidiOverrides(segment.text) }
      : segment,
  );
}

/** Whether `text` has a C0 control character (tab, line break, …) or DEL. */
function hasControl(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** A web link the kit will open: the address to follow and the label to show. */
export interface CheckedLink {
  /** The parsed address (`URL.href`): punycode host, percent-encoded path. */
  href: string;
  /**
   * What is shown: the parsed address as the parser serialises it (protocol, punycode host, percent-encoded path,
   * query and fragment), never decoded, so a space, an invisible character or a bidi control stays `%xx`.
   */
  label: string;
}

/**
 * A link segment's address checked and the label drawn for it; null for an address that is not drawn as a link:
 * anything but http or https, and any address with a user name or password (`https://bank.example@evil.example/`
 * reads as one host and goes to another).
 */
export function checkLink(href: string): CheckedLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  const label = `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
  return { href: url.href, label: stripBidi(label) };
}

/** A link segment's address, if it is one the kit will open (http or https), as parsed; otherwise null. */
export function safeHref(href: string): string | null {
  return checkLink(href)?.href ?? null;
}

const INTERNAL_BASE = 'https://kit.invalid';

/**
 * A mention's address, if it stays inside the app: a hash route (`#/…`) or a path with a single leading slash
 * (`/…`) that resolves to the app's own origin. `//host`, `/\host`, a tab or newline that the URL parser would
 * drop to make `//`, a `//` or a `.`/`..` segment anywhere in the path, and any scheme are refused (null).
 */
export function internalHref(href: string): string | null {
  if (!href.startsWith('#/') && !(href.startsWith('/') && !href.startsWith('//'))) return null;
  // Characters the URL parser strips or treats as a slash, which could turn `/` into `//`.
  if (hasControl(href) || href.includes('\\')) return null;
  // The path (of the page, or of the hash route): no empty segment and no `.` or `..` segment, which could leave a
  // path that starts with `//` (`/.//evil.example`) for code that later reuses it as an address.
  const route = href.startsWith('#') ? href.slice(1) : href;
  const path = route.split(/[?#]/, 1)[0];
  if (path.includes('//')) return null;
  const dotSegment = (segment: string) => /^(?:\.|%2e){1,2}$/i.test(segment);
  if (path.split('/').some(dotSegment)) return null;
  try {
    const url = new URL(href, `${INTERNAL_BASE}/`);
    return url.origin === INTERNAL_BASE && !url.pathname.startsWith('//') ? href : null;
  } catch {
    return null;
  }
}
