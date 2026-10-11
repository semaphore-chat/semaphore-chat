import { ApiProperty } from '@nestjs/swagger';
import { RegistrationModeValues } from '@/common/enums/swagger-enums';

export class PublicSettingsResponseDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ enum: RegistrationModeValues })
  registrationMode: string;

  @ApiProperty()
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
  totalUsers: number;
  totalCommunities: number;
  totalChannels: number;
  totalMessages: number;
  activeInvites: number;
  bannedUsers: number;
}
