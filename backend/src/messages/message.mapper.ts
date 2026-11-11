import { Prisma } from '@prisma/client';
import { groupReactions } from '@/common/utils/reactions.utils';
import {
  AttachmentDto,
  LinkPreviewDto,
  MessageDto,
  MessageReactionsDto,
  ReplyToPreviewDto,
  SpanDto,
} from './dto/message-response.dto';

/** Prisma select shape for file metadata sent to clients */
const FILE_METADATA_SELECT = {
  id: true,
  filename: true,
  mimeType: true,
  fileType: true,
  size: true,
  thumbnailPath: true,
} as const;

/** Prisma select shape for the webhook attribution sent to clients */
const WEBHOOK_METADATA_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
} as const;

/** Standard includes for loading a message with its relations */
export const MESSAGE_INCLUDE = {
  spans: { orderBy: { position: 'asc' as const } },
  reactions: true,
  attachments: {
    include: { file: { select: FILE_METADATA_SELECT } },
    orderBy: { position: 'asc' as const },
  },
  webhook: { select: WEBHOOK_METADATA_SELECT },
} as const;

/** MESSAGE_INCLUDE plus the replyToMessage relation for inline quote preview */
export const MESSAGE_INCLUDE_WITH_REPLY = {
  ...MESSAGE_INCLUDE,
  replyToMessage: {
    include: {
      spans: { orderBy: { position: 'asc' as const } },
    },
  },
} as const;

type MessageRow = Prisma.MessageGetPayload<{
  include: typeof MESSAGE_INCLUDE;
}> & {
  replyToMessage?: Prisma.MessageGetPayload<{
    include: { spans: true };
  }> | null;
};

/** The columns of a span a client gets, whichever query loaded it. */
export type SpanColumns = Omit<
  MessageRow['spans'][number],
  'id' | 'messageId' | 'position'
>;
type FileRow = MessageRow['attachments'][number]['file'];

const toIso = (date: Date | null): string | null =>
  date ? date.toISOString() : null;

/** The fields of a span every reader may get, for a quote preview. */
function toPreviewSpan(span: SpanColumns): SpanDto {
  return {
    type: span.type,
    text: span.text,
    userId: span.userId,
    specialKind: span.specialKind,
    communityId: span.communityId,
    aliasId: span.aliasId,
    emojiId: span.emojiId,
    bold: span.bold,
    italic: span.italic,
    strikethrough: span.strikethrough,
    code: span.code,
  };
}

export function toSpanDto(span: SpanColumns): SpanDto {
  return { ...toPreviewSpan(span), channelId: span.channelId };
}

export function toAttachmentDto(file: FileRow): AttachmentDto {
  return {
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    fileType: file.fileType,
    size: file.size,
    hasThumbnail: !!file.thumbnailPath,
  };
}

function toReplyToPreview(
  quoted: NonNullable<MessageRow['replyToMessage']>,
): ReplyToPreviewDto {
  return {
    id: quoted.id,
    authorId: quoted.authorId,
    spans: quoted.deletedAt ? [] : quoted.spans.map(toPreviewSpan),
    sentAt: quoted.sentAt.toISOString(),
    deletedAt: toIso(quoted.deletedAt),
  };
}

/**
 * The only way a message row becomes a client-facing message, on REST and on
 * the socket. It lists every field, so a new column stays private until it is
 * added here and to MessageDto.
 */
export function toMessageDto(row: MessageRow): MessageDto {
  return {
    clientNonce: row.clientNonce,
    id: row.id,
    channelId: row.channelId,
    directMessageGroupId: row.directMessageGroupId,
    authorId: row.authorId,
    spans: row.spans.map(toSpanDto),
    attachments: row.attachments.map((a) => toAttachmentDto(a.file)),
    pendingAttachments: row.pendingAttachments,
    reactions: groupReactions(row.reactions),
    linkPreviews: row.linkPreviews as unknown as LinkPreviewDto[] | null,
    replyCount: row.replyCount,
    lastReplyAt: toIso(row.lastReplyAt),
    pinned: row.pinned,
    pinnedAt: toIso(row.pinnedAt),
    pinnedBy: row.pinnedBy,
    sentAt: row.sentAt.toISOString(),
    editedAt: toIso(row.editedAt),
    deletedAt: toIso(row.deletedAt),
    parentMessageId: row.parentMessageId,
    replyToId: row.replyToId,
    replyTo: row.replyToMessage ? toReplyToPreview(row.replyToMessage) : null,
    webhook: row.webhook,
    deletedBy: row.deletedBy,
    deletedByReason: row.deletedByReason,
  };
}

export function toMessageReactionsDto(
  row: Prisma.MessageGetPayload<{ include: { reactions: true } }>,
): MessageReactionsDto {
  return {
    id: row.id,
    channelId: row.channelId,
    directMessageGroupId: row.directMessageGroupId,
    parentMessageId: row.parentMessageId,
    deletedAt: toIso(row.deletedAt),
    reactions: groupReactions(row.reactions),
  };
}
