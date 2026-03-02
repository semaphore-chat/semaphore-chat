import { $Enums } from '@prisma/client';
import { Exclude } from 'class-transformer';
import { IsString, IsOptional, IsArray, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SpanTypeValues } from '@/common/enums/swagger-enums';
import { ArrayMinLength } from '../../decorators/array-min-length.decorator';

class CreateMessageSpanDto {
  @ApiProperty({ enum: SpanTypeValues })
  type: $Enums.SpanType;
  text: string | null;
  userId: string | null;
  specialKind: string | null;
  communityId: string | null;
  aliasId: string | null;
}

export class CreateMessageDto {
  @Exclude()
  id: string;

  @IsOptional()
  @IsString()
  channelId: string | null;

  @IsOptional()
  @IsString()
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
  spans: CreateMessageSpanDto[];

  @IsArray()
  attachments: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
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
  replyCount: number;

  @Exclude()
  lastReplyAt: Date | null;
}
