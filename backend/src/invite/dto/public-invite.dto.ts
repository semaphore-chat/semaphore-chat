import { ApiProperty } from '@nestjs/swagger';

class PublicInviteCreatorDto {
  username: string;
}

/**
 * The public lookup, answered to anyone with the code: what the join screen
 * shows and nothing else. No ids, redeemers or target communities.
 */
export class PublicInviteDto {
  code: string;
  @ApiProperty({ type: 'integer' })
  uses: number;
  @ApiProperty({ type: 'integer', nullable: true })
  maxUses: number | null;
  validUntil: Date | null;
  disabled: boolean;
  createdBy?: PublicInviteCreatorDto | null;
}
