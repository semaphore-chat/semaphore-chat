import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorCode } from '@semaphore-chat/shared';

export class SendAckErrorDto {
  @ApiProperty({ enum: ErrorCode, enumName: 'ErrorCode' })
  errorCode: ErrorCode;

  @ApiProperty({ type: String })
  message: string;

  @ApiProperty({ type: Boolean })
  retryable: boolean;

  @ApiPropertyOptional({ type: Number })
  retryAfterMs?: number;
}

/**
 * The ack of a send, for a client that connected with `auth.protocol: 2`:
 * `messageId` when `ok`, otherwise `error`.
 */
export class SendAckDto {
  @ApiProperty({ type: Boolean })
  ok: boolean;

  @ApiPropertyOptional({ type: String })
  messageId?: string;

  @ApiPropertyOptional({ type: SendAckErrorDto })
  error?: SendAckErrorDto;
}
