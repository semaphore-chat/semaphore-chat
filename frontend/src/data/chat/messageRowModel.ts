/**
 * Pure mappers from a message (and what the screen knows around it) to what the kit's chat pieces draw: the row's
 * header and state (`MessageRow`), its reactions (`ReactionChip`), its reply quote (`MessageQuote`) and its files
 * (`AttachmentTile`). The rules are the old row's (`components/Message/MessageComponent.tsx`), so both shells say
 * the same thing about the same message. No React, no data fetching: a native shell can mirror them.
 */
import type { Message } from '../../types/message.type';
import { SpanType } from '../../types/message.type';
import { formatClockTime, formatFullTimestamp, formatMessageTime } from '../../utils/messageTime';
import { formatFileSize } from '../../utils/format';
import { isOptimisticMessageId } from '../../utils/messageCacheUpdaters';
import { isUserMentioned } from './messageUtils';

/** The author as the row names them. */
export interface RowAuthor {
  /** A display name, else the username. */
  name?: string | null;
  avatarFileId?: string | null;
}

/** What a `MessageRow` shows, minus its slots. */
export interface RowView {
  author: string;
  /** The author can open a profile (a real user, not a webhook or a deleted account). */
  hasProfile: boolean;
  /** A webhook's own picture (an address), when the message came from one. */
  webhookAvatar?: string;
  time: string;
  dateTime: string;
  timeLabel: string;
  mentioned: boolean;
  edited: boolean;
  pinned: boolean;
  state: 'sent' | 'pending' | 'failed';
  failedReason?: string;
  /** Not confirmed by the server yet: it cannot be reacted to or replied to. */
  optimistic: boolean;
}

export interface RowViewContext {
  author?: RowAuthor;
  /** The reader's user id. */
  me?: string;
  /** A day separator above already names the day: the time alone ("4:12 PM"), not "Yesterday 4:12 PM". */
  dayShownAbove: boolean;
  now?: Date;
}

/** The name the old row shows for a message whose author account is gone. */
export const DELETED_USER = 'Deleted user';

export function toRowView(message: Message, { author, me, dayShownAbove, now }: RowViewContext): RowView {
  const webhook = message.webhook;
  const name = webhook
    ? webhook.name
    : message.authorId
      ? author?.name || message.authorId
      : DELETED_USER;
  const state = message.sendStatus ?? 'sent';
  return {
    author: name,
    hasProfile: !webhook && !!message.authorId,
    ...(webhook?.avatarUrl ? { webhookAvatar: webhook.avatarUrl } : {}),
    time: dayShownAbove ? formatClockTime(message.sentAt) : formatMessageTime(message.sentAt, now),
    dateTime: new Date(message.sentAt).toISOString(),
    timeLabel: formatFullTimestamp(message.sentAt),
    mentioned: isUserMentioned(message, me),
    edited: !!message.editedAt,
    pinned: !!message.pinned,
    state,
    ...(state === 'failed' && message.sendError ? { failedReason: message.sendError } : {}),
    optimistic: message.sendStatus !== undefined || isOptimisticMessageId(message.id),
  };
}

/**
 * Why a failed send failed, in words (as the old row's Retry line). A send that raced a timeout comes back as a
 * plain refusal, so a time-out the reader is under (from the channel's capabilities, the same the composer's
 * countdown uses) wins over the server's message. `undefined` when there is nothing to say: the caller's default
 * ("Failed to send", "Not sent").
 */
export function sendFailureReason(sendError: string | null | undefined, timedOutUntil: Date | undefined): string | undefined {
  if (timedOutUntil) return `Timed out until ${formatClockTime(timedOutUntil)}`;
  return sendError ?? undefined;
}

/** A reaction as a chip draws it. */
export interface ReactionView {
  /** The stored reaction (`😂`, or `custom:<emoji id>`): what a toggle sends back. */
  key: string;
  /** What is drawn: the emoji itself, a custom emoji's `:name:` (its image's fallback), or a neutral placeholder. */
  emoji: string;
  /** A custom emoji's image. */
  src?: string;
  /** The words a screen reader says for the emoji. For a custom emoji its name. */
  label: string;
  count: number;
  mine: boolean;
}

/** The stored prefix of a community (custom) emoji reaction: `custom:{emojiId}` (as the old chips). */
export const CUSTOM_REACTION_PREFIX = 'custom:';
/** What an unknown or deleted custom emoji draws (as the old chips). */
export const UNKNOWN_CUSTOM_EMOJI = '❓';

export interface ReactionContext {
  emojiById?: ReadonlyMap<string, { name: string; fileId: string }>;
  fileUrl?: (fileId: string) => string | null;
}

/** The reactions with at least one person, in their order; custom emoji resolved through the community's. */
export function toReactionViews(
  reactions: Message['reactions'],
  me: string | undefined,
  { emojiById, fileUrl }: ReactionContext = {},
): ReactionView[] {
  return (reactions ?? [])
    .filter((r) => (r.userIds?.length ?? 0) > 0)
    .map((r) => {
      const base = { key: r.emoji, count: r.userIds.length, mine: me !== undefined && r.userIds.includes(me) };
      if (!r.emoji.startsWith(CUSTOM_REACTION_PREFIX)) return { ...base, emoji: r.emoji, label: r.emoji };
      const custom = emojiById?.get(r.emoji.slice(CUSTOM_REACTION_PREFIX.length));
      if (!custom) return { ...base, emoji: UNKNOWN_CUSTOM_EMOJI, label: 'Custom emoji' };
      const src = fileUrl?.(custom.fileId) ?? undefined;
      return { ...base, emoji: `:${custom.name}:`, label: custom.name, ...(src ? { src } : {}) };
    });
}

/** A reply's quote. */
export interface QuoteView {
  id: string;
  authorId: string | null;
  /** The first plain text of the original, or "Message" (as the old quote). */
  line: string;
  deleted: boolean;
}

export function toQuoteView(replyTo: Message['replyTo']): QuoteView | null {
  if (!replyTo) return null;
  const deleted = !!replyTo.deletedAt;
  const line = replyTo.spans.find((s) => s.type === SpanType.PLAINTEXT)?.text || 'Message';
  return { id: replyTo.id, authorId: replyTo.authorId, line, deleted };
}

/** What a file is to the reader, from its type (as the old attachment preview): drawn, played, or downloaded. */
export type MediaType = 'image' | 'video' | 'audio' | 'other';

export function attachmentMediaType(mimeType?: string | null): MediaType {
  if (!mimeType) return 'other';
  const lower = mimeType.toLowerCase();
  if (lower.startsWith('image/')) return 'image';
  if (lower.startsWith('video/')) return 'video';
  if (lower.startsWith('audio/')) return 'audio';
  return 'other';
}

/** The pictures of a message the full-size viewer steps through, in their order (as the old lightbox). */
export function viewerImages<T extends { mimeType?: string | null }>(attachments: readonly T[] | null | undefined): T[] {
  return (attachments ?? []).filter((a) => attachmentMediaType(a.mimeType) === 'image');
}

/** A file of a message, as a tile draws it. */
export interface AttachmentView {
  id: string;
  /** Images are drawn; everything else (video and audio too, until they have players) is a file row. */
  kind: 'image' | 'file';
  name: string;
  /** The type the server reported: decides whether pressing it opens or downloads it. */
  mimeType: string;
  detail: string;
  width: number | null;
  height: number | null;
}

export function toAttachmentViews(attachments: Message['attachments']): AttachmentView[] {
  return (attachments ?? []).map((a) => ({
    id: a.id,
    kind: a.fileType === 'IMAGE' ? 'image' : 'file',
    name: a.filename,
    mimeType: a.mimeType ?? '',
    detail: formatFileSize(a.size),
    width: a.width ?? null,
    height: a.height ?? null,
  }));
}
