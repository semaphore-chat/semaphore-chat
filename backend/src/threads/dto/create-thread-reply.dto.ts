import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { CreateMessageSpanDto } from '@/messages/dto/create-message.dto';

/**
 * DTO for creating a thread reply message.
 * Thread replies are stored as regular messages with a parentMessageId.
 */
export class CreateThreadReplyDto {
  @IsString()
  parentMessageId: string;

  @ApiProperty({ type: [CreateMessageSpanDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMessageSpanDto)
  spans: CreateMessageSpanDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  attachments?: string[];

  @IsInt()
  @Min(0)
  @IsOptional()
  @ApiPropertyOptional({ type: 'integer' })
  pendingAttachments?: number;

  /**
   * The sender's id for this send (a UUID). Retrying with the same one returns
   * the same message instead of creating another.
   */
  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ type: String, nullable: true })
  clientNonce?: string | null;
}

/**
 * The REST body: the parent comes from the route. A real class, because the
 * validation pipe skips a body typed `Omit<...>` (no runtime type).
 */
export class CreateThreadReplyBodyDto extends OmitType(CreateThreadReplyDto, [
  'parentMessageId',
] as const) {}
