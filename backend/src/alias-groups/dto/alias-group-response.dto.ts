import { ApiProperty } from '@nestjs/swagger';

export class AliasGroupMemberDto {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export class AliasGroupWithMembersDto {
  id: string;
  name: string;
  communityId: string;
  createdAt: Date;
  @ApiProperty({ type: 'integer' })
  memberCount: number;

  @ApiProperty({ type: [AliasGroupMemberDto] })
  members: AliasGroupMemberDto[];
}

export class AliasGroupSummaryDto {
  id: string;
  name: string;
  communityId: string;
  @ApiProperty({ type: 'integer' })
  memberCount: number;
}
