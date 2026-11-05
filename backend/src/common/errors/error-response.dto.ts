import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorCode } from '@semaphore-chat/shared';

/** The body of every REST error. See docs: architecture/error-handling. */
export class ErrorResponseDto {
  @ApiProperty({ type: Number })
  statusCode: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message: string | string[];

  @ApiPropertyOptional({ type: String })
  error?: string;

  @ApiProperty({
    enum: ErrorCode,
    enumName: 'ErrorCode',
    description:
      'Stable and append-only. Clients must also accept codes they do not know, and handle those by retryable and status.',
  })
  errorCode: ErrorCode;

  @ApiProperty({
    type: Boolean,
    description: 'Whether a client may retry the same request automatically.',
  })
  retryable: boolean;

  @ApiPropertyOptional({
    type: Number,
    description:
      'How long until the same request can succeed, when the server knows. Also set on some errors that are not retryable, for display.',
  })
  retryAfterMs?: number;
}
