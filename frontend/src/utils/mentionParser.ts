import { SpanType, Span as MessageSpan } from "../types/message.type";

export interface MentionMatch {
  type: 'user' | 'special' | 'channel' | 'alias';
  start: number;
  end: number;
  text: string;
  query: string;
  id?: string;
}

export interface UserMention {
  id: string;
  username: string;
  displayName?: string;
}

export interface ChannelMention {
  id: string;
  name: string;
}

export interface AliasMention {
  id: string;
  name: string;
}

export interface EmojiMention {
  id: string;
  name: string;
}

/** Matches a `:shortcode:` custom-emoji token (lowercase, digits, underscore). */
const EMOJI_TOKEN_REGEX = /:([a-z0-9_]{2,32}):/g;

/**
 * Find regions in text that are inside code blocks or inline code.
 * Returns array of [start, end] ranges that should be excluded from mention parsing.
 */
export function getCodeRegions(text: string): [number, number][] {
  const regions: [number, number][] = [];

  // Match fenced code blocks (```...```) first, then inline code (`...`)
  const codeRegex = /```[\s\S]*?```|`[^`]+`/g;
  let match;
  while ((match = codeRegex.exec(text)) !== null) {
    regions.push([match.index, match.index + match[0].length]);
  }

  return regions;
}

/**
 * Check if a position falls inside any code region
 */
function isInsideCodeRegion(position: number, end: number, regions: [number, number][]): boolean {
  return regions.some(([start, regionEnd]) => position >= start && end <= regionEnd);
}

/**
 * Parse message text for potential mentions (@user, @here, @channel, #channel)
 * Returns array of mention objects with positions.
 * Mentions inside code blocks/inline code are excluded.
 */
export function findMentions(text: string): MentionMatch[] {
  const mentions: MentionMatch[] = [];
  const codeRegions = getCodeRegions(text);

  // User mentions pattern: @word (word can contain letters, numbers, underscore, hyphen)
  const userMentionRegex = /@(\w[\w\-_]*)/g;
  let match;

  while ((match = userMentionRegex.exec(text)) !== null) {
    const matchEnd = match.index + match[0].length;
    if (isInsideCodeRegion(match.index, matchEnd, codeRegions)) continue;

    const query = match[1];
    // Check if this is a special mention
    if (query === 'here' || query === 'channel') {
      mentions.push({
        type: 'special',
        start: match.index,
        end: matchEnd,
        text: match[0],
        query: query,
      });
    } else {
      mentions.push({
        type: 'user',
        start: match.index,
        end: matchEnd,
        text: match[0],
        query: query,
      });
    }
  }

  // Channel mentions pattern: #word (word can contain letters, numbers, underscore, hyphen)
  const channelMentionRegex = /#(\w[\w\-_]*)/g;

  while ((match = channelMentionRegex.exec(text)) !== null) {
    const matchEnd = match.index + match[0].length;
    if (isInsideCodeRegion(match.index, matchEnd, codeRegions)) continue;

    const query = match[1];
    mentions.push({
      type: 'channel',
      start: match.index,
      end: matchEnd,
      text: match[0],
      query: query,
    });
  }

  return mentions.sort((a, b) => a.start - b.start);
}

/**
 * Convert a run of plain text (already stripped of code and formatting markers)
 * into PLAINTEXT + resolved mention spans. Whitespace is preserved so that
 * spacing between formatted runs survives.
 */
function parseMentionRun(
  text: string,
  userMentions: UserMention[],
  channelMentions: ChannelMention[],
  aliasMentions: AliasMention[],
  emojiMentions: EmojiMention[] = []
): MessageSpan[] {
  const spans: MessageSpan[] = [];

  // Collect resolved custom-emoji tokens (unknown shortcodes stay literal) and
  // interleave them with mentions, ordered by position.
  const emojiTokens: {
    type: 'emoji';
    start: number;
    end: number;
    text: string;
    emoji: EmojiMention;
  }[] = [];
  if (emojiMentions.length > 0) {
    const byName = new Map(emojiMentions.map((e) => [e.name, e]));
    let m: RegExpExecArray | null;
    EMOJI_TOKEN_REGEX.lastIndex = 0;
    while ((m = EMOJI_TOKEN_REGEX.exec(text)) !== null) {
      const emoji = byName.get(m[1]);
      if (emoji) {
        emojiTokens.push({
          type: 'emoji',
          start: m.index,
          end: m.index + m[0].length,
          text: m[0],
          emoji,
        });
      }
    }
  }

  const tokens = [...findMentions(text), ...emojiTokens].sort(
    (a, b) => a.start - b.start
  );

  let lastIndex = 0;

  for (const mention of tokens) {
    // Skip tokens overlapping an already-consumed region.
    if (mention.start < lastIndex) continue;

    // Add plaintext before this token
    if (mention.start > lastIndex) {
      const plaintext = text.substring(lastIndex, mention.start);
      if (plaintext) {
        spans.push({ type: SpanType.PLAINTEXT, text: plaintext });
      }
    }

    if (mention.type === 'emoji') {
      spans.push({
        type: SpanType.EMOJI,
        text: mention.text, // `:shortcode:` for round-trip + fallback
        emojiId: mention.emoji.id,
      });
    } else if (mention.type === 'user') {
      // First check if this is an alias group mention
      const resolvedAlias = aliasMentions.find(
        alias => alias.name.toLowerCase() === mention.query.toLowerCase()
      );

      if (resolvedAlias) {
        spans.push({
          type: SpanType.ALIAS_MENTION,
          text: `@${resolvedAlias.name}`,
          aliasId: resolvedAlias.id,
        });
      } else {
        // Then check if it's a user mention
        const resolvedUser = userMentions.find(
          user => user.username.toLowerCase() === mention.query.toLowerCase()
        );

        if (resolvedUser) {
          spans.push({
            type: SpanType.USER_MENTION,
            text: `@${resolvedUser.username}`,
            userId: resolvedUser.id,
          });
        } else {
          // Unresolved mention becomes plaintext
          spans.push({ type: SpanType.PLAINTEXT, text: mention.text });
        }
      }
    } else if (mention.type === 'special') {
      // Special mentions (@here, @channel)
      spans.push({
        type: SpanType.SPECIAL_MENTION,
        text: mention.text,
        specialKind: mention.query,
      });
    } else if (mention.type === 'channel') {
      // Channel mentions (#channel-name)
      const resolvedChannel = channelMentions.find(
        channel => channel.name.toLowerCase() === mention.query.toLowerCase()
      );

      if (resolvedChannel) {
        // Only the id: the server stores no channel name (text stays empty)
        // and readers resolve it from the channels they can see
        spans.push({
          type: SpanType.CHANNEL_MENTION,
          channelId: resolvedChannel.id,
        });
      } else {
        // Unresolved channel mention becomes plaintext
        spans.push({ type: SpanType.PLAINTEXT, text: mention.text });
      }
    }

    lastIndex = mention.end;
  }

  // Add remaining plaintext
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    if (remainingText) {
      spans.push({ type: SpanType.PLAINTEXT, text: remainingText });
    }
  }

  return spans;
}

/** Composable inline-formatting flags carried while parsing. */
interface StyleFlags {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
}

/**
 * Markdown-style inline delimiters. Ordered longest-first so `**` is matched
 * before `*`.
 */
const INLINE_DELIMITERS: { marker: string; flag: keyof StyleFlags }[] = [
  { marker: '**', flag: 'bold' },
  { marker: '~~', flag: 'strikethrough' },
  { marker: '*', flag: 'italic' },
  { marker: '_', flag: 'italic' },
];

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /\w/.test(ch);
}

/**
 * Locate the matching closing marker starting at `from`, or -1 if none.
 * Skips empty pairs (e.g. `****`) and, for `_`, intraword occurrences so that
 * identifiers like `snake_case` are not mangled into italics.
 */
function findClosingMarker(text: string, from: number, marker: string): number {
  let idx = from;
  while (idx <= text.length - marker.length) {
    const found = text.indexOf(marker, idx);
    if (found === -1) return -1;
    if (found === from) {
      // Empty content between the markers — not a valid delimiter pair.
      idx = found + marker.length;
      continue;
    }
    if (marker === '_' && isWordChar(text[found + marker.length])) {
      // Intraword underscore (e.g. snake_case) — keep looking.
      idx = found + 1;
      continue;
    }
    return found;
  }
  return -1;
}

/** Apply the active style flags to a PLAINTEXT span (mentions pass through). */
function withStyle(span: MessageSpan, style: StyleFlags): MessageSpan {
  if (span.type !== SpanType.PLAINTEXT) return span;
  const styled: MessageSpan = { ...span };
  if (style.bold) styled.bold = true;
  if (style.italic) styled.italic = true;
  if (style.strikethrough) styled.strikethrough = true;
  return styled;
}

/**
 * Parse a segment (no fenced code blocks) into spans, handling inline code and
 * composable bold/italic/strikethrough formatting. Mentions are resolved within
 * the plain runs between markers. Inline code is verbatim — no formatting,
 * mentions, or auto-linking inside.
 */
function parseInline(
  text: string,
  style: StyleFlags,
  userMentions: UserMention[],
  channelMentions: ChannelMention[],
  aliasMentions: AliasMention[],
  emojiMentions: EmojiMention[] = []
): MessageSpan[] {
  const result: MessageSpan[] = [];
  let buffer = '';
  let i = 0;

  const flushBuffer = () => {
    if (!buffer) return;
    const runSpans = parseMentionRun(
      buffer,
      userMentions,
      channelMentions,
      aliasMentions,
      emojiMentions
    );
    for (const s of runSpans) result.push(withStyle(s, style));
    buffer = '';
  };

  while (i < text.length) {
    const ch = text[i];

    // Inline code: `...` — rendered verbatim.
    if (ch === '`') {
      const close = text.indexOf('`', i + 1);
      if (close !== -1 && close > i + 1) {
        flushBuffer();
        const codeSpan: MessageSpan = {
          type: SpanType.PLAINTEXT,
          text: text.slice(i + 1, close),
          code: true,
        };
        if (style.bold) codeSpan.bold = true;
        if (style.italic) codeSpan.italic = true;
        if (style.strikethrough) codeSpan.strikethrough = true;
        result.push(codeSpan);
        i = close + 1;
        continue;
      }
    }

    // Inline formatting delimiters.
    let matched = false;
    for (const { marker, flag } of INLINE_DELIMITERS) {
      if (style[flag]) continue; // Already inside this style.
      if (!text.startsWith(marker, i)) continue;
      if (marker === '_' && isWordChar(text[i - 1])) continue; // Intraword opening.
      const close = findClosingMarker(text, i + marker.length, marker);
      if (close === -1) continue;
      flushBuffer();
      const inner = text.slice(i + marker.length, close);
      result.push(
        ...parseInline(
          inner,
          { ...style, [flag]: true },
          userMentions,
          channelMentions,
          aliasMentions,
          emojiMentions
        )
      );
      i = close + marker.length;
      matched = true;
      break;
    }
    if (matched) continue;

    buffer += ch;
    i++;
  }

  flushBuffer();
  return result;
}

/**
 * Strip an optional leading language/info line and a single trailing newline
 * from a fenced code block's raw contents.
 */
function extractCodeBlockContent(raw: string): string {
  let content = raw;
  const newlineIdx = content.indexOf('\n');
  if (newlineIdx !== -1) {
    const firstLine = content.slice(0, newlineIdx).trim();
    // Drop the fence's info line when it's blank or a bare language token.
    if (firstLine === '' || /^[a-zA-Z0-9_+-]+$/.test(firstLine)) {
      content = content.slice(newlineIdx + 1);
    }
  }
  // Remove the single trailing newline before the closing fence.
  return content.replace(/\n$/, '');
}

/**
 * Parse message text with resolved mentions and markdown-style rich-text
 * formatting into a MessageSpan array. Used when converting composer input to
 * database spans.
 *
 * Supports: `**bold**`, `*italic*` / `_italic_`, `~~strike~~`, `` `inline code` ``
 * (verbatim), and ```` ```fenced code blocks``` ```` (verbatim CODE_BLOCK spans).
 * Formatting composes (bold+italic) and mentions still resolve inside formatted
 * runs. Nothing is parsed inside code.
 */
export function parseMessageWithMentions(
  text: string,
  userMentions: UserMention[] = [],
  channelMentions: ChannelMention[] = [],
  aliasMentions: AliasMention[] = [],
  emojiMentions: EmojiMention[] = []
): MessageSpan[] {
  const spans: MessageSpan[] = [];

  // Extract fenced code blocks first so their contents stay verbatim.
  const fenceRegex = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      spans.push(
        ...parseInline(
          text.slice(lastIndex, match.index),
          {},
          userMentions,
          channelMentions,
          aliasMentions,
          emojiMentions
        )
      );
    }
    spans.push({
      type: SpanType.CODE_BLOCK,
      text: extractCodeBlockContent(match[1]),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    spans.push(
      ...parseInline(
        text.slice(lastIndex),
        {},
        userMentions,
        channelMentions,
        aliasMentions,
        emojiMentions
      )
    );
  }

  return spans;
}

/**
 * Convert message spans back to display text for editing
 * Used when loading existing message for editing
 */
export function spansToText(
  spans: MessageSpan[],
  /** Resolves a #channel mention's name from the reader's visible channels. */
  channelName?: (channelId: string) => string | undefined,
): string {
  return spans.map(span => {
    switch (span.type) {
      case SpanType.CHANNEL_MENTION:
        // Spans store no channel name; a channel the reader can't see (or a
        // deleted one) comes back as the generic placeholder
        return `#${(span.channelId && channelName?.(span.channelId)) || 'private-channel'}`;
      case SpanType.USER_MENTION:
        return span.text || `@user`;
      case SpanType.SPECIAL_MENTION:
        return span.text || `@${span.specialKind}`;
      case SpanType.COMMUNITY_MENTION:
      case SpanType.ALIAS_MENTION:
        return span.text || '';
      case SpanType.EMOJI:
        // Round-trips to `:shortcode:` (stored on span.text).
        return span.text || '';
      case SpanType.CODE_BLOCK:
        return '```\n' + (span.text || '') + '\n```';
      case SpanType.PLAINTEXT:
      default: {
        let t = span.text || '';
        // Inline code is verbatim — never wrap it in other markers.
        if (span.code) return '`' + t + '`';
        // Re-apply markers inner-to-outer so bold+italic round-trips as
        // `**_text_**` (avoids the ambiguous `***text***` form).
        if (span.strikethrough) t = `~~${t}~~`;
        if (span.italic) t = `_${t}_`;
        if (span.bold) t = `**${t}**`;
        return t;
      }
    }
  }).join('');
}

/**
 * Get the current mention being typed (if any) at cursor position
 * Returns null if no mention, or mention info if typing a mention
 */
export function getCurrentMention(
  text: string,
  cursorPosition: number
): { type: 'user' | 'special' | 'channel'; query: string; start: number; end: number } | null {
  // Look backwards from cursor to find start of potential mention
  let start = cursorPosition;

  // Find the start of the current word/mention
  while (start > 0) {
    const char = text[start - 1];
    if (char === '@') {
      const query = text.substring(start, cursorPosition);

      // Validate query (should only contain valid mention characters)
      if (/^[\w\-_]*$/.test(query)) {
        // Determine if this is a special mention
        const mentionType = (query === 'here' || query === 'channel') ? 'special' : 'user';
        return {
          type: mentionType,
          query,
          start: start - 1, // Include the @
          end: cursorPosition,
        };
      }
      break;
    } else if (char === '#') {
      const query = text.substring(start, cursorPosition);

      // Validate query (should only contain valid mention characters)
      if (/^[\w\-_]*$/.test(query)) {
        return {
          type: 'channel',
          query,
          start: start - 1, // Include the #
          end: cursorPosition,
        };
      }
      break;
    } else if (/[\w\-_]/.test(char)) {
      start--;
    } else {
      // Hit a non-mention character, stop looking
      break;
    }
  }

  return null;
}

/**
 * Insert a resolved mention into text at the current cursor position
 * Used when user selects a mention from autocomplete
 */
export function insertMention(
  text: string,
  cursorPosition: number,
  mention: { type: 'user' | 'special' | 'channel' | 'alias'; username?: string; specialKind?: string; channelName?: string; aliasName?: string }
): { newText: string; newCursorPosition: number } {
  const currentMention = getCurrentMention(text, cursorPosition);

  if (!currentMention) {
    // No current mention, just insert at cursor
    let insertText: string;
    if (mention.type === 'user') {
      insertText = `@${mention.username} `;
    } else if (mention.type === 'special') {
      insertText = `@${mention.specialKind} `;
    } else if (mention.type === 'alias') {
      insertText = `@${mention.aliasName} `;
    } else {
      insertText = `#${mention.channelName} `;
    }

    const newText = text.slice(0, cursorPosition) + insertText + text.slice(cursorPosition);
    return {
      newText,
      newCursorPosition: cursorPosition + insertText.length,
    };
  }

  // Replace current mention
  let insertText: string;
  if (mention.type === 'user') {
    insertText = `@${mention.username} `;
  } else if (mention.type === 'special') {
    insertText = `@${mention.specialKind} `;
  } else if (mention.type === 'alias') {
    insertText = `@${mention.aliasName} `;
  } else {
    insertText = `#${mention.channelName} `;
  }

  const newText = text.slice(0, currentMention.start) + insertText + text.slice(currentMention.end);
  return {
    newText,
    newCursorPosition: currentMention.start + insertText.length,
  };
}

/**
 * Resolve mention text for display purposes
 * Used in MessageComponent to show resolved mentions
 */
export function resolveMentionText(
  span: MessageSpan,
  users: UserMention[] = []
): string {
  switch (span.type) {
    case SpanType.USER_MENTION:
      if (span.userId) {
        const user = users.find(u => u.id === span.userId);
        if (user) {
          return `@${user.displayName || user.username}`;
        }
      }
      return span.text || '@unknown';
      
    case SpanType.SPECIAL_MENTION:
      return span.text || `@${span.specialKind}`;
      
    case SpanType.PLAINTEXT:
    default:
      return span.text || '';
  }
}