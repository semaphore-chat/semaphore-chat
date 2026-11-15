import { ApiProperty } from '@nestjs/swagger';

export class UserPresenceResponseDto {
  userId: string;
  isOnline: boolean;
}

export class BulkPresenceResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: { type: 'boolean' } })
  presence: Record<string, boolean>;
}

/** Who of one community is online, for a community-wide "N around" count. */
export class CommunityPresenceResponseDto {
  @ApiProperty({
    type: [String],
    description: 'Ids of the community members who are online now.',
  })
  onlineUserIds: string[];

  @ApiProperty({
    type: 'integer',
    example: 3,
    description: 'onlineUserIds.length',
  })
  onlineCount: number;

  @ApiProperty({
    type: 'integer',
    example: 42,
    description: 'Total members of the community.',
  })
  memberCount: number;
}
