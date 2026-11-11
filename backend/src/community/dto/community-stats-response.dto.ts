import { ApiProperty } from '@nestjs/swagger';

export class CommunityStatsDto {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  banner: string | null;
  createdAt: Date;
  @ApiProperty({ type: 'integer' })
  memberCount: number;
  @ApiProperty({ type: 'integer' })
  channelCount: number;
}

export class CommunityStatsDetailDto extends CommunityStatsDto {
  @ApiProperty({ type: 'integer' })
  messageCount: number;
}

export class CommunityStatsListResponseDto {
  communities: CommunityStatsDto[];
  continuationToken?: string;
}
