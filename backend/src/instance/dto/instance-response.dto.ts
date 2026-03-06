import { ApiProperty } from '@nestjs/swagger';
import { RegistrationModeValues } from '@/common/enums/swagger-enums';

export class PublicSettingsResponseDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ enum: RegistrationModeValues })
  registrationMode: string;

  @ApiProperty()
  maxFileSizeBytes: number;
}

export class InstanceStatsResponseDto {
  totalUsers: number;
  totalCommunities: number;
  totalChannels: number;
  totalMessages: number;
  activeInvites: number;
  bannedUsers: number;
}
