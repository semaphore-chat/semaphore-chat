import {
  IsBoolean,
  IsEnum,
  IsUUID,
  IsOptional,
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for updating a replay clip (e.g., toggling public visibility)
 */
export class UpdateClipDto {
  /**
   * Whether the clip should be publicly visible on user's profile
   */
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

/**
 * DTO for sharing an existing clip to a channel or DM
 */
export class ShareClipDto {
  /**
   * Where to share the clip
   * - 'channel': Post to specified channel
   * - 'dm': Send to specified DM group
   */
  @ApiProperty({ enum: ['channel', 'dm'] })
  @IsEnum(['channel', 'dm'], {
    message: 'Destination must be channel or dm',
  })
  destination: 'channel' | 'dm';

  /**
   * Required if destination is 'channel'
   * Channel ID to post the clip to
   */
  @ValidateIf((o: ShareClipDto) => o.destination === 'channel')
  @IsUUID()
  targetChannelId?: string;

  /**
   * Required if destination is 'dm'
   * Direct message group ID to send clip to
   */
  @ValidateIf((o: ShareClipDto) => o.destination === 'dm')
  @IsUUID()
  targetDirectMessageGroupId?: string;
}

/**
 * Response DTO for a single clip in the library
 */
export class ClipResponseDto {
  id: string;
  fileId: string;
  channelId: string | null;
  durationSeconds: number;
  isPublic: boolean;
  capturedAt: Date;
  downloadUrl: string;
  sizeBytes: number;
  filename: string;
}

/**
 * Response DTO for sharing a clip
 */
export class ShareClipResponseDto {
  messageId: string;
  clipId: string;
  @ApiProperty({ enum: ['channel', 'dm'] })
  destination: 'channel' | 'dm';
}
