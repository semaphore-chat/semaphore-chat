import {
  IsBoolean,
  IsEnum,
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SpanType } from '@prisma/client';
import { ApiProperty, OmitType } from '@nestjs/swagger';
import { SpanTypeValues } from '@/common/enums/swagger-enums';

class ThreadReplySpanDto {
  @ApiProperty({ enum: SpanTypeValues })
  @IsEnum(SpanType)
  type: SpanType;

  @IsOptional()
  @IsString()
  text: string | null;

  @IsOptional()
  @IsString()
  userId: string | null;

  @IsOptional()
  @IsString()
  specialKind: string | null;

  @IsOptional()
  @IsString()
  communityId: string | null;

  /** For CHANNEL_MENTION (text is ignored and stored as null). */
  @ApiProperty({ type: String, required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  channelId?: string | null;

  @IsOptional()
  @IsString()
  aliasId: string | null;

  @IsOptional()
  @IsString()
  emojiId?: string | null;

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

/**
 * DTO for creating a thread reply message.
 * Thread replies are stored as regular messages with a parentMessageId.
 */
export class CreateThreadReplyDto {
  @IsString()
  parentMessageId: string;

  @ApiProperty({ type: [ThreadReplySpanDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ThreadReplySpanDto)
  spans: ThreadReplySpanDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  attachments?: string[];

  @IsInt()
  @Min(0)
  @IsOptional()
  pendingAttachments?: number;
}

/**
 * The REST body: the parent comes from the path. A class, unlike
 * `Omit<CreateThreadReplyDto, ...>`, so the validation pipe actually sees it.
 */
export class CreateThreadReplyBodyDto extends OmitType(CreateThreadReplyDto, [
  'parentMessageId',
] as const) {}
