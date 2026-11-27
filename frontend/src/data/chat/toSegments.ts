/**
 * A message's stored spans as the segments the kit's `MessageText` draws. Pure: what it needs from the app (who is
 * reading, the community's custom emoji, which channels the reader can see) comes in as plain values and lookups.
 *
 * It follows the old renderer (`components/Message/MessageSpan.tsx`) case by case, so both shells show the same
 * words: the same auto-link pattern, the same mention texts and fallbacks, the same hidden-channel label, the same
 * shortcode fallback for an unknown emoji. One difference is the kit's own: `MessageText` draws only safe web links
 * as links (no `user:pass@` addresses), where the old renderer links any `http(s)://` match.
 */
import { stripBidiOverrides, type MessageSegment, type SegmentStyle } from '../../kit';
import { SpanType, type Span } from '../../types/message.type';

/** What a #channel mention shows when the reader can't see the channel (as the old renderer). */
export const HIDDEN_CHANNEL_LABEL = '#private-channel';

/** The old renderer's auto-link pattern: an http(s) address, without trailing sentence punctuation. */
export const URL_PATTERN = /(https?:\/\/[^\s<>)"']*[^\s<>)"'.,!?;:])/g;

/** A channel the reader can see, as a mention needs it. */
export interface MentionChannel {
  id: string;
  name: string;
  communityId: string;
}

export interface ToSegmentsOptions {
  /** The reader's user id: a mention of them is drawn as mentioning the reader. */
  me?: string;
  /** The community's custom emoji by id (name and file). */
  emojiById?: ReadonlyMap<string, { name: string; fileId: string }>;
  /** A visible channel by id; undefined when the reader cannot see it. */
  channelById?: (id: string) => MentionChannel | undefined;
  /** The address of an emoji's image file. */
  fileUrl?: (fileId: string) => string | null;
  /** Where a visible channel mention goes (a hash route or a path). Default: the app's channel route. */
  channelHref?: (channel: MentionChannel) => string;
}

const defaultChannelHref = (channel: MentionChannel) => `#/community/${channel.communityId}/channel/${channel.id}`;

function styleOf(span: Span): SegmentStyle {
  const style: SegmentStyle = {};
  if (span.bold) style.bold = true;
  if (span.italic) style.italic = true;
  if (span.strikethrough) style.strike = true;
  return style;
}

/** Plain text split into words and links, as the old renderer's auto-linking. */
function textSegments(text: string, style: SegmentStyle): MessageSegment[] {
  const out: MessageSegment[] = [];
  for (const part of text.split(URL_PATTERN)) {
    if (part === '') continue;
    if (/^https?:\/\//.test(part)) out.push({ type: 'link', href: part, ...style });
    else out.push({ type: 'text', text: part, ...style });
  }
  return out;
}

function spanSegments(span: Span, options: ToSegmentsOptions): MessageSegment[] {
  switch (span.type) {
    case SpanType.EMOJI: {
      const emoji = span.emojiId ? options.emojiById?.get(span.emojiId) : undefined;
      if (!emoji) return span.text ? [{ type: 'text', text: span.text }] : [];
      const src = options.fileUrl?.(emoji.fileId) ?? undefined;
      return [{ type: 'emoji', name: emoji.name, ...(src ? { src } : {}) }];
    }
    case SpanType.USER_MENTION:
      return [
        {
          type: 'mention',
          kind: 'user',
          text: span.text || span.userId || '',
          ...(span.userId ? { id: span.userId } : {}),
          ...(span.userId && span.userId === options.me ? { me: true } : {}),
        },
      ];
    case SpanType.SPECIAL_MENTION:
      // @everyone and @here reach the reader too.
      return [{ type: 'mention', kind: 'everyone', text: `@${span.specialKind ?? ''}`, me: true }];
    case SpanType.COMMUNITY_MENTION:
      return [{ type: 'mention', kind: 'everyone', text: span.text || span.communityId || '' }];
    case SpanType.ALIAS_MENTION:
      return [
        { type: 'mention', kind: 'role', text: span.text || span.aliasId || '', ...(span.aliasId ? { id: span.aliasId } : {}) },
      ];
    case SpanType.CHANNEL_MENTION: {
      // The span stores only the id (a hidden channel's name never leaks): the name is the reader's own.
      const channel = span.channelId ? options.channelById?.(span.channelId) : undefined;
      if (!channel) return [{ type: 'mention', kind: 'channel', text: HIDDEN_CHANNEL_LABEL, unavailable: true }];
      const href = (options.channelHref ?? defaultChannelHref)(channel);
      return [{ type: 'mention', kind: 'channel', text: `#${channel.name}`, id: channel.id, href }];
    }
    case SpanType.CODE_BLOCK:
      return [{ type: 'codeBlock', text: span.text ?? '' }];
    case SpanType.PLAINTEXT:
    default:
      // Inline code is verbatim: no auto-linking, no formatting.
      if (span.code) return [{ type: 'code', text: span.text ?? '' }];
      return textSegments(span.text ?? '', styleOf(span));
  }
}

/** The segments for a message's spans, in order. */
export function toSegments(spans: readonly Span[], options: ToSegmentsOptions = {}): MessageSegment[] {
  return spans.flatMap((span) => spanSegments(span, options));
}

/** The words of spans as one plain line (a reply quote): segments' visible text, line breaks as spaces. */
export function segmentsLine(segments: readonly MessageSegment[]): string {
  return segments
    .map((segment) => {
      switch (segment.type) {
        case 'link':
          return segment.href;
        case 'emoji':
          return `:${segment.name}:`;
        default:
          return segment.text;
      }
    })
    .map(stripBidiOverrides)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
