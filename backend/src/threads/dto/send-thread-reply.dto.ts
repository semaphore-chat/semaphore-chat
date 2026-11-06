import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
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
  pendingAttachments?: number;
}
