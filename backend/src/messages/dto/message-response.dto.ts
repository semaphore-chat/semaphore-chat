import { FileType, SpanType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { SpanTypeValues, FileTypeValues } from '@/common/enums/swagger-enums';

export class SpanDto {
  @ApiProperty({ enum: SpanTypeValues })
  type: SpanType;
  text: string | null;
  userId: string | null;
  specialKind: string | null;
  communityId: string | null;
  aliasId: string | null;
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

export class EnrichedMessageDto {
  id: string;
  channelId: string | null;
  directMessageGroupId: string | null;
  authorId: string | null;
  spans: SpanDto[];
  attachments: EnrichedAttachment[];
  pendingAttachments: number | null;
  reactions: ReactionDto[];
  replyCount: number;
  lastReplyAt: Date | null;
  pinned: boolean;
  pinnedAt: Date | null;
  pinnedBy: string | null;
  sentAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
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
}

export class PaginatedMessagesResponseDto {
  messages: EnrichedMessageDto[];
  continuationToken?: string;
}
