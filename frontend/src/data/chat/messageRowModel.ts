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

/** A reaction as a chip draws it. */
export interface ReactionView {
  emoji: string;
  /** The words a screen reader says for the emoji. For a custom emoji its name. */
  label: string;
  count: number;
  mine: boolean;
}

/** The reactions with at least one person, in their order. */
export function toReactionViews(reactions: Message['reactions'], me: string | undefined): ReactionView[] {
  return (reactions ?? [])
    .filter((r) => (r.userIds?.length ?? 0) > 0)
    .map((r) => ({
      emoji: r.emoji,
      label: r.emoji,
      count: r.userIds.length,
      mine: me !== undefined && r.userIds.includes(me),
    }));
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

/** A file of a message, as a tile draws it. */
export interface AttachmentView {
  id: string;
  /** Images are drawn; everything else (video and audio too, until they have players) is a file row. */
  kind: 'image' | 'file';
  name: string;
  detail: string;
  width: number | null;
  height: number | null;
}

export function toAttachmentViews(attachments: Message['attachments']): AttachmentView[] {
  return (attachments ?? []).map((a) => ({
    id: a.id,
    kind: a.fileType === 'IMAGE' ? 'image' : 'file',
    name: a.filename,
    detail: formatFileSize(a.size),
    width: a.width ?? null,
    height: a.height ?? null,
  }));
}
