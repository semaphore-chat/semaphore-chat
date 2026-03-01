import {
  IsEnum,
  IsOptional,
  IsUUID,
  ValidateIf,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for streaming a replay clip (download-only, no persistence)
 */
export class StreamReplayDto {
  /**
   * Duration preset in minutes
   * User selects from: 1, 2, 5, or 10 minutes
   */
  @ApiProperty({ enum: [1, 2, 5, 10] })
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
  @ApiProperty({ enum: [1, 2, 5, 10], required: false })
  @IsOptional()
  @ValidateIf((o: CaptureReplayDto) => !o.startSeconds && !o.endSeconds)
  @IsEnum([1, 2, 5, 10], {
    message: 'Duration must be 1, 2, 5, or 10 minutes',
  })
  durationMinutes?: 1 | 2 | 5 | 10;

  /**
   * Custom clip start time in seconds from buffer start
   * Required if using custom range (no durationMinutes)
   */
  @IsOptional()
  @ValidateIf((o: CaptureReplayDto) => !o.durationMinutes)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  startSeconds?: number;

  /**
   * Custom clip end time in seconds from buffer start
   * Required if using custom range (no durationMinutes)
   */
  @IsOptional()
  @ValidateIf((o: CaptureReplayDto) => !o.durationMinutes)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  endSeconds?: number;

  /**
   * Where to save/post the clip
   * - 'library': Save to user's clip library only
   * - 'dm': Save to library and send to specified DM group
   * - 'channel': Save to library and post to specified channel
   */
  @ApiProperty({ enum: ['library', 'dm', 'channel'] })
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
  durationSeconds: number;

  /**
   * Requested duration in seconds (for comparison)
   */
  requestedDurationSeconds: number;

  /**
   * File size in bytes
   */
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
  totalSegments?: number;

  /**
   * Total buffer duration in seconds
   */
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
