import { ApiProperty } from '@nestjs/swagger';

/**
 * Simplified user info for invite responses
 */
class InviteCreatorDto {
  id: string;
  username: string;
  displayName: string | null;
}

class InviteDefaultCommunityDto {
  id: string;
  communityId: string;
}

class InviteUsageDto {
  id: string;
  userId: string;
  usedAt: Date;
}

/**
 * Instance invite response DTO
 */
export class InviteResponseDto {
  id: string;
  code: string;
  createdById: string | null;
  @ApiProperty({ type: 'integer', nullable: true })
  maxUses: number | null;
  @ApiProperty({ type: 'integer' })
  uses: number;
  validUntil: Date | null;
  createdAt: Date;
  disabled: boolean;
  createdBy?: InviteCreatorDto | null;
  defaultCommunities: InviteDefaultCommunityDto[];
  usages: InviteUsageDto[];
}
