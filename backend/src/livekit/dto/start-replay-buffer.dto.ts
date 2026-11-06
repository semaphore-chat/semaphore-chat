import { IsString, IsUUID, IsOptional } from 'class-validator';

export class StartReplayBufferDto {
  @IsUUID()
  channelId: string;

  /**
   * Ignored: the room is the authorized channel's. Existing clients send it.
   */
  @IsOptional()
  @IsString()
  roomName?: string;

  @IsString()
  videoTrackId: string;

  @IsOptional()
  @IsString()
  audioTrackId?: string;

  /**
   * Ignored: the tracks must be the caller's own. Existing clients send it.
   */
  @IsOptional()
  @IsString()
  participantIdentity?: string;
}
