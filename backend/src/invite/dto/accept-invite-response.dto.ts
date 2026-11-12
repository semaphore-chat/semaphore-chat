import { ApiProperty } from '@nestjs/swagger';

/** Why a community in an invite was not joined. */
export type InviteSkipReason = 'already_member' | 'banned';

export class InviteCommunityDto {
  id: string;
  name: string;
}

export class SkippedInviteCommunityDto extends InviteCommunityDto {
  @ApiProperty({
    enum: ['already_member', 'banned'],
    enumName: 'InviteSkipReason',
  })
  reason: InviteSkipReason;
}

/** What accepting an invite did, per community. */
export class AcceptInviteResponseDto {
  @ApiProperty({ type: [InviteCommunityDto] })
  joined: InviteCommunityDto[];

  @ApiProperty({ type: [SkippedInviteCommunityDto] })
  skipped: SkippedInviteCommunityDto[];
}
