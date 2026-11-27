/**
 * What `MessageText` draws: a message's words, already parsed. The kit only renders these; turning a message's
 * stored spans into segments (`toSegments(spans)`) is the chat data layer's job, so this file has no parser.
 *
 * Segments are inline and drawn in order, except `codeBlock`, which is a block of its own.
 */

import { checkLink } from '../../utils/links';
import { stripBidi, stripBidiOverrides, stripUnpairedBidi } from '../../utils/bidi';

export { checkLink, stripBidi, stripBidiOverrides, stripUnpairedBidi };
export type { CheckedLink } from '../../utils/links';

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

/**
 * The segments with unpaired bidi controls dropped from every text, code and code-block run, and every control
 * from a mention's text (a mention is drawn in an isolate of its own).
 */
export function cleanSegments(segments: readonly MessageSegment[]): MessageSegment[] {
  return segments.map((segment) => {
    if (segment.type === 'text' || segment.type === 'code' || segment.type === 'codeBlock') {
      return { ...segment, text: stripUnpairedBidi(segment.text) };
    }
    return segment.type === 'mention' ? { ...segment, text: stripBidiOverrides(segment.text) } : segment;
  });
}

/** Whether `text` has a C0 control character (tab, line break, …) or DEL. */
function hasControl(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
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
