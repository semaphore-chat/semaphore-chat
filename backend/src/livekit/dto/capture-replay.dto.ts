import {
  IsEnum,
  ValidateIf,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  IsUUID,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Present means "sent": 0 is a valid value, unlike an absent field. */
const isGiven = (value: unknown): boolean =>
  value !== undefined && value !== null;

@ValidatorConstraint({ name: 'endAfterStart', async: false })
class EndAfterStartConstraint implements ValidatorConstraintInterface {
  validate(endSeconds: number, args: ValidationArguments): boolean {
    const { startSeconds } = args.object as CaptureReplayDto;
    return !isGiven(startSeconds) || endSeconds > startSeconds!;
  }

  defaultMessage(): string {
    return 'endSeconds must be greater than startSeconds';
  }
}

/**
 * DTO for streaming a replay clip (download-only, no persistence)
 */
export class StreamReplayDto {
  /**
   * Duration preset in minutes
   * User selects from: 1, 2, 5, or 10 minutes
   */
  @ApiProperty({
    enum: [1, 2, 5, 10],
    enumName: 'ReplayDurationMinutes',
    type: 'integer',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  @IsEnum([1, 2, 5, 10], {
    message: 'Duration must be 1, 2, 5, or 10 minutes',
  })
  durationMinutes: 1 | 2 | 5 | 10;
}

/**
 * DTO for capturing and posting a replay clip to channel or DM
 */
export class CaptureReplayDto {
  /**
   * Duration preset in minutes (optional if using custom range)
   * User selects from: 1, 2, 5, or 10 minutes
   */
  @ApiProperty({
    enum: [1, 2, 5, 10],
    enumName: 'ReplayDurationMinutes',
    type: 'integer',
    required: false,
  })
  // Required when no complete custom range is sent; validated whenever it is
  // sent, even next to a range (the service prefers the range, but a bad
  // value must not pass unnoticed).
  @ValidateIf(
    (o: CaptureReplayDto) =>
      !(isGiven(o.startSeconds) && isGiven(o.endSeconds)) ||
      isGiven(o.durationMinutes),
  )
  @IsEnum([1, 2, 5, 10], {
    message: 'Duration must be 1, 2, 5, or 10 minutes',
  })
  durationMinutes?: 1 | 2 | 5 | 10;

  /**
   * Custom clip start time in seconds from buffer start
   * Required if using custom range (no durationMinutes)
   */
  @ValidateIf((o: CaptureReplayDto) => isGiven(o.startSeconds))
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({ type: 'integer' })
  startSeconds?: number;

  /**
   * Custom clip end time in seconds from buffer start
   * Required if using custom range (no durationMinutes)
   */
  @ValidateIf((o: CaptureReplayDto) => isGiven(o.endSeconds))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Validate(EndAfterStartConstraint)
  @ApiPropertyOptional({ type: 'integer' })
  endSeconds?: number;

  /**
   * Where to save/post the clip
   * - 'library': Save to user's clip library only
   * - 'dm': Save to library and send to specified DM group
   * - 'channel': Save to library and post to specified channel
   */
  @ApiProperty({
    enum: ['library', 'dm', 'channel'],
    enumName: 'CaptureReplayDestination',
  })
  @IsEnum(['library', 'dm', 'channel'], {
    message: 'Destination must be library, dm, or channel',
  })
  destination: 'library' | 'dm' | 'channel';

  /**
   * Required if destination is 'channel'
   * Channel ID to post the clip to
   */
  @ValidateIf((o: CaptureReplayDto) => o.destination === 'channel')
  @IsUUID()
  targetChannelId?: string;

  /**
   * Required if destination is 'dm'
   * Direct message group ID to send clip to
   */
  @ValidateIf((o: CaptureReplayDto) => o.destination === 'dm')
  @IsUUID()
  targetDirectMessageGroupId?: string;
}

/**
 * Response DTO for capture replay operation
 */
export class CaptureReplayResponseDto {
  /**
   * ID of the created ReplayClip record
   */
  clipId: string;

  /**
   * ID of the created File record
   */
  fileId: string;

  /**
   * Actual duration of the clip in seconds
   */
  @ApiProperty({ type: 'integer' })
  durationSeconds: number;

  /**
   * Requested duration in seconds (for comparison)
   */
  @ApiProperty({ type: 'integer' })
  requestedDurationSeconds: number;

  /**
   * File size in bytes
   */
  @ApiProperty({ type: 'integer', format: 'int64' })
  sizeBytes: number;

  /**
   * Download URL for the clip
   */
  downloadUrl: string;

  /**
   * Optional: Message ID if auto-posted to channel/DM
   */
  messageId?: string;
}

/**
 * Response DTO for session info (buffer metadata)
 */
export class SessionInfoResponseDto {
  /**
   * Whether there's an active replay buffer session
   */
  hasActiveSession: boolean;

  /**
   * Session ID (if active)
   */
  sessionId?: string;

  /**
   * Total number of segments available
   */
  @ApiPropertyOptional({ type: 'integer' })
  totalSegments?: number;

  /**
   * Total buffer duration in seconds
   */
  @ApiPropertyOptional({ type: 'integer' })
  totalDurationSeconds?: number;

  /**
   * Oldest segment timestamp (when buffer started)
   */
  bufferStartTime?: Date;

  /**
   * Most recent segment timestamp
   */
  bufferEndTime?: Date;
}
