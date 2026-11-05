import { FileType, SpanType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SpanTypeValues, FileTypeValues } from '@/common/enums/swagger-enums';

export class SpanDto {
  @ApiProperty({ enum: SpanTypeValues, enumName: 'SpanType' })
  type: SpanType;
  text: string | null;
  userId: string | null;
  specialKind: string | null;
  communityId: string | null;
  /** For CHANNEL_MENTION; resolve the name from the channels you can see. */
  @ApiPropertyOptional({ type: String, nullable: true })
  channelId?: string | null;
  aliasId: string | null;
  @ApiPropertyOptional()
  emojiId?: string | null;
  @ApiPropertyOptional()
  bold?: boolean | null;
  @ApiPropertyOptional()
  italic?: boolean | null;
  @ApiPropertyOptional()
  strikethrough?: boolean | null;
  @ApiPropertyOptional()
  code?: boolean | null;
}

export class ReactionDto {
  emoji: string;
  userIds: string[];
}

export class AttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  @ApiProperty({ enum: FileTypeValues, enumName: 'FileType' })
  fileType: FileType;
  @ApiProperty({ type: 'integer', format: 'int64' })
  size: number;
  hasThumbnail: boolean;
}

export class WebhookInfoDto {
  id: string;
  name: string;
  @ApiPropertyOptional()
  avatarUrl?: string | null;
}

export class ReplyToPreviewDto {
  id: string;
  authorId: string | null;
  spans: SpanDto[];
  @ApiProperty({ type: String, format: 'date-time' })
  sentAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt: string | null;
}

export class LinkPreviewDto {
  url: string;
  @ApiPropertyOptional()
  title?: string;
  @ApiPropertyOptional()
  description?: string;
  @ApiPropertyOptional()
  imageUrl?: string;
  @ApiPropertyOptional()
  siteName?: string;
  @ApiPropertyOptional()
  faviconUrl?: string;
  @ApiPropertyOptional()
  authorName?: string;
}

/**
 * The one message shape, on REST and on the socket. Built by toMessageDto().
 * Every field is always present, null when it has no value, except the optional
 * ones below.
 */
export class MessageDto {
  id: string;
  channelId: string | null;
  directMessageGroupId: string | null;
  /** Null for a deleted user's messages and for webhook messages. */
  authorId: string | null;
  spans: SpanDto[];
  attachments: AttachmentDto[];
  @ApiProperty({ type: 'integer', nullable: true })
  pendingAttachments: number | null;
  reactions: ReactionDto[];
  @ApiProperty({ type: [LinkPreviewDto], nullable: true })
  linkPreviews: LinkPreviewDto[] | null;
  @ApiProperty({ type: 'integer' })
  replyCount: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastReplyAt: string | null;
  pinned: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pinnedAt: string | null;
  pinnedBy: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  sentAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  editedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt: string | null;
  parentMessageId: string | null;
  replyToId: string | null;
  @ApiProperty({ type: ReplyToPreviewDto, nullable: true })
  replyTo: ReplyToPreviewDto | null;
  @ApiProperty({ type: WebhookInfoDto, nullable: true })
  webhook: WebhookInfoDto | null;
  /** Who removed the message. Null unless the reader may see removed messages. */
  @ApiPropertyOptional({ type: String, nullable: true })
  deletedBy?: string | null;
  /** Why it was removed. Null unless the reader may see removed messages. */
  @ApiPropertyOptional({ type: String, nullable: true })
  deletedByReason?: string | null;
  /** Reserved for the sender's correlation id; not sent yet. */
  @ApiPropertyOptional({ type: String, nullable: true })
  clientNonce?: string | null;
}

/** What the reaction endpoints answer: where the message is and its reactions. */
export class MessageReactionsDto {
  id: string;
  channelId: string | null;
  directMessageGroupId: string | null;
  parentMessageId: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt: string | null;
  reactions: ReactionDto[];
}

export class CommunitySearchResultDto extends MessageDto {
  channelName: string;
}

export class PaginatedMessagesResponseDto {
  messages: MessageDto[];
  continuationToken?: string;
}

export class AnchoredMessagesResponseDto {
  messages: MessageDto[];
  olderContinuationToken?: string;
  newerContinuationToken?: string;
}
