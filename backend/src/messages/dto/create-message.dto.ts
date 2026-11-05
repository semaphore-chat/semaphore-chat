import { $Enums } from '@prisma/client';
import { Exclude, Type } from 'class-transformer';
import {
  IsEnum,
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  IsUUID,
  IsBoolean,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SpanTypeValues } from '@/common/enums/swagger-enums';
import { ArrayMinLength } from '../../decorators/array-min-length.decorator';

/**
 * One span of a message, as a client sends it. Spans are validated and
 * whitelisted (`@ValidateNested` on the parent), so a client can only set these
 * fields: everything else about a span is the server's.
 */
export class CreateMessageSpanDto {
  @ApiProperty({ enum: SpanTypeValues, enumName: 'SpanType' })
  @IsEnum($Enums.SpanType)
  type: $Enums.SpanType;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  text?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  specialKind?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  communityId?: string | null;

  /** For CHANNEL_MENTION (text is ignored and stored as null). */
  @ApiProperty({ type: String, required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  channelId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  aliasId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  emojiId?: string | null;

  // Composable inline-formatting flags (optional, PLAINTEXT spans).
  @IsOptional()
  @IsBoolean()
  bold?: boolean | null;

  @IsOptional()
  @IsBoolean()
  italic?: boolean | null;

  @IsOptional()
  @IsBoolean()
  strikethrough?: boolean | null;

  @IsOptional()
  @IsBoolean()
  code?: boolean | null;
}

export class CreateMessageDto {
  @Exclude()
  id: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  channelId: string | null;

  @IsOptional()
  @IsString()
  @IsUUID()
  directMessageGroupId: string | null;

  @Exclude()
  authorId: string;

  @Exclude()
  sentAt: Date;

  @Exclude()
  editedAt: Date | null;

  @Exclude()
  deletedAt: Date | null;

  @ApiProperty({ type: [CreateMessageSpanDto] })
  @IsArray()
  @ArrayMinLength(1, { message: 'At least one span is required' })
  @ValidateNested({ each: true })
  @Type(() => CreateMessageSpanDto)
  spans: CreateMessageSpanDto[];

  @IsArray()
  attachments: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  pendingAttachments: number | null;

  @Exclude()
  searchText: string | null;

  // Pinning fields (excluded - set by moderation actions)
  @Exclude()
  pinned: boolean;

  @Exclude()
  pinnedAt: Date | null;

  @Exclude()
  pinnedBy: string | null;

  // Moderation deletion fields (excluded - set by moderation actions)
  @Exclude()
  deletedBy: string | null;

  @Exclude()
  deletedByReason: string | null;

  // Threading fields (excluded - set by threading system)
  @Exclude()
  parentMessageId: string | null;

  @Exclude()
  @ApiProperty({ type: 'integer' })
  replyCount: number;

  @Exclude()
  lastReplyAt: Date | null;

  // Inline reply (quote) reference - client-provided
  @IsOptional()
  @IsString()
  @IsUUID()
  replyToId?: string | null;
}
