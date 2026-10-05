import { FileType, Prisma, SpanType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SpanTypeValues, FileTypeValues } from '@/common/enums/swagger-enums';

export class SpanDto {
  @ApiProperty({ enum: SpanTypeValues })
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

export class EnrichedAttachment {
  id: string;
  filename: string;
  mimeType: string;
  @ApiProperty({ enum: FileTypeValues })
  fileType: FileType;
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
  sentAt: Date;
  @ApiPropertyOptional()
  deletedAt: Date | null;
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

export class EnrichedMessageDto {
  id: string;
  channelId: string | null;
  directMessageGroupId: string | null;
  authorId: string | null;
  spans: SpanDto[];
  attachments: EnrichedAttachment[];
  pendingAttachments: number | null;
  reactions: ReactionDto[];
  @ApiPropertyOptional({ type: [LinkPreviewDto] })
  linkPreviews?: LinkPreviewDto[] | Prisma.JsonValue | null;
  replyCount: number;
  lastReplyAt: Date | null;
  pinned: boolean;
  pinnedAt: Date | null;
  pinnedBy: string | null;
  sentAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  @ApiPropertyOptional()
  replyToId?: string | null;
  @ApiPropertyOptional({ type: ReplyToPreviewDto })
  replyTo?: ReplyToPreviewDto | null;
  @ApiPropertyOptional({ type: WebhookInfoDto })
  webhook?: WebhookInfoDto | null;
}

export class MessageDto {
  id: string;
  channelId: string | null;
  directMessageGroupId: string | null;
  authorId: string | null;
  spans: SpanDto[];
  attachments: string[];
  pendingAttachments: number | null;
  reactions: ReactionDto[];
  @ApiPropertyOptional({ type: [LinkPreviewDto] })
  linkPreviews?: LinkPreviewDto[] | Prisma.JsonValue | null;
  replyCount: number;
  lastReplyAt: Date | null;
  pinned: boolean;
  pinnedAt: Date | null;
  pinnedBy: string | null;
  sentAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  searchText: string | null;
  deletedBy: string | null;
  deletedByReason: string | null;
  parentMessageId: string | null;
  @ApiPropertyOptional()
  replyToId?: string | null;
  @ApiPropertyOptional({ type: WebhookInfoDto })
  webhook?: WebhookInfoDto | null;
}

export class PaginatedMessagesResponseDto {
  messages: EnrichedMessageDto[];
  continuationToken?: string;
}

export class AnchoredMessagesResponseDto {
  messages: EnrichedMessageDto[];
  olderContinuationToken?: string;
  newerContinuationToken?: string;
}
