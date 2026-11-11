import { ApiProperty } from '@nestjs/swagger';

export class VoicePresenceUserDto {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  /** ISO-8601 timestamp, as sent on the socket. */
  @ApiProperty({ type: String, format: 'date-time' })
  joinedAt: string;
  isDeafened: boolean;
  isServerMuted: boolean;
}

export class ChannelVoicePresenceResponseDto {
  channelId: string;
  users: VoicePresenceUserDto[];
  @ApiProperty({ type: 'integer' })
  count: number;
}

export class DmVoicePresenceResponseDto {
  dmGroupId: string;
  users: VoicePresenceUserDto[];
  @ApiProperty({ type: 'integer' })
  count: number;
}

export class RefreshPresenceResponseDto {
  success: boolean;
  message: string;
  channelId: string;
}

export class RefreshDmPresenceResponseDto {
  success: boolean;
  message: string;
  dmGroupId: string;
}

export class UserVoiceChannelsResponseDto {
  userId: string;
  voiceChannels: string[];
}
