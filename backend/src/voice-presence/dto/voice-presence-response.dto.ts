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

/**
 * A user in the channel presence GET: the socket shape plus what the caller
 * may do about them. Socket events keep the plain {@link VoicePresenceUserDto}
 * because they are shared by every recipient.
 */
export class ChannelVoicePresenceUserDto extends VoicePresenceUserDto {
  /**
   * Whether the caller may server mute this user or remove them from the
   * call. Never set for the caller's own entry.
   */
  @ApiProperty({ required: false })
  canModerate?: boolean;
}

export class ChannelVoicePresenceResponseDto {
  channelId: string;
  @ApiProperty({ type: [ChannelVoicePresenceUserDto] })
  users: ChannelVoicePresenceUserDto[];
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

export class DeclineDmVoiceCallResponseDto {
  success: boolean;
  message: string;
  dmGroupId: string;
}

export class UserVoiceChannelsResponseDto {
  userId: string;
  voiceChannels: string[];
}
