import { ApiProperty } from '@nestjs/swagger';
import { RegistrationModeValues } from '@/common/enums/swagger-enums';

export class PublicSettingsResponseDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ enum: RegistrationModeValues, enumName: 'RegistrationMode' })
  registrationMode: string;

  @ApiProperty({ type: 'integer', format: 'int64' })
  maxFileSizeBytes: number;

  /** Whether the Giphy GIF picker is available (GIPHY_API_KEY configured). */
  @ApiProperty()
  gifSearchEnabled: boolean;

  @ApiProperty()
  passwordResetEnabled: boolean;

  /**
   * The desktop app can sign in through the browser (POST
   * /auth/desktop/authorize and /auth/desktop/token). Older servers don't
   * send it: the app hides the button for them.
   */
  @ApiProperty()
  desktopBrowserLogin: boolean;
}

export class InstanceStatsResponseDto {
  @ApiProperty({ type: 'integer' })
  totalUsers: number;
  @ApiProperty({ type: 'integer' })
  totalCommunities: number;
  @ApiProperty({ type: 'integer' })
  totalChannels: number;
  @ApiProperty({ type: 'integer' })
  totalMessages: number;
  @ApiProperty({ type: 'integer' })
  activeInvites: number;
  @ApiProperty({ type: 'integer' })
  bannedUsers: number;
}
