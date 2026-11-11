import {
  ApiProperty,
  ApiPropertyOptional,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';
import { MessageDto } from '@/messages/dto/message-response.dto';

export class FileMetadataEntryDto {
  filename: string;
  mimeType: string;
  @ApiProperty({ type: 'integer', format: 'int64' })
  size: number;
}

@ApiExtraModels(FileMetadataEntryDto)
export class ThreadRepliesResponseDto {
  replies: MessageDto[];
  continuationToken?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(FileMetadataEntryDto) },
  })
  fileMetadata?: Record<string, FileMetadataEntryDto>;
}

export class ThreadMetadataDto {
  parentMessageId: string;
  @ApiProperty({ type: 'integer' })
  replyCount: number;
  lastReplyAt: Date | null;
  isSubscribed: boolean;
}
