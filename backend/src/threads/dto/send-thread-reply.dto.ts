import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateMessageSpanDto } from '@/messages/dto/create-message.dto';

/**
 * DTO for sending a thread reply via WebSocket.
 */
export class SendThreadReplyDto {
  @IsString()
  parentMessageId: string;

  @ApiProperty({ type: [CreateMessageSpanDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMessageSpanDto)
  spans: CreateMessageSpanDto[];

  @IsArray()
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
