import {
  ApiPropertyOptional,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  SpanDto,
  ReactionDto,
  EnrichedAttachment,
} from '@/messages/dto/message-response.dto';

export class ThreadReplyDto {
  id: string;
  channelId: string | null;
  directMessageGroupId: string | null;
  authorId: string | null;
  spans: SpanDto[];
  attachments: EnrichedAttachment[];
  pendingAttachments: number | null;
  reactions: ReactionDto[];
  sentAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  pinned: boolean;
  pinnedAt: Date | null;
  pinnedBy: string | null;
  replyCount: number;
  lastReplyAt: Date | null;
  parentMessageId: string | null;
  searchText: string | null;
  deletedBy: string | null;
  deletedByReason: string | null;
}

export class EnrichedThreadReplyDto {
  id: string;
  channelId: string | null;
  directMessageGroupId: string | null;
  authorId: string | null;
  spans: SpanDto[];
  attachments: EnrichedAttachment[];
  pendingAttachments: number | null;
  reactions: ReactionDto[];
  sentAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  pinned: boolean;
  pinnedAt: Date | null;
  pinnedBy: string | null;
  replyCount: number;
  lastReplyAt: Date | null;
  parentMessageId: string | null;
  searchText: string | null;
  deletedBy: string | null;
  deletedByReason: string | null;
}

export class FileMetadataEntryDto {
  filename: string;
  mimeType: string;
  size: number;
}

@ApiExtraModels(FileMetadataEntryDto)
export class ThreadRepliesResponseDto {
  replies: EnrichedThreadReplyDto[];
  continuationToken?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(FileMetadataEntryDto) },
  })
  fileMetadata?: Record<string, FileMetadataEntryDto>;
}

export class ThreadMetadataDto {
  parentMessageId: string;
  replyCount: number;
  lastReplyAt: Date | null;
  isSubscribed: boolean;
}
