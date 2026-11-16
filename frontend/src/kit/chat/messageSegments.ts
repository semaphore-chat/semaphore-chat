/**
 * What `MessageText` draws: a message's words, already parsed. The kit only renders these; turning a message's
 * stored spans into segments (`toSegments(spans)`) is the chat data layer's job, so this file has no parser.
 *
 * Segments are inline and drawn in order, except `codeBlock`, which is a block of its own.
 */

/** Words, with the inline formatting a message can carry. Line breaks in `text` are kept. */
export interface TextSegment {
  type: 'text';
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
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
 * A web link. It opens in a new tab. Only `http:` and `https:` links are links: anything else (`javascript:`,
 * `data:`) is drawn as its text, never as a link.
 */
export interface LinkSegment {
  type: 'link';
  href: string;
  /** What is shown; defaults to `href`. */
  text?: string;
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
  /** Where a channel mention goes. */
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

/** A link segment's address, if it is one the kit will open (http or https); otherwise null. */
export function safeHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? href : null;
  } catch {
    return null;
  }
}
