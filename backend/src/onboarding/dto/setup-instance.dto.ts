import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEmail,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MAX_LENGTH_MESSAGE,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_LENGTH_MESSAGE,
  USERNAME_MAX_LENGTH,
  USERNAME_MAX_LENGTH_MESSAGE,
  USERNAME_MIN_LENGTH,
  USERNAME_MIN_LENGTH_MESSAGE,
  USERNAME_PATTERN_MESSAGE,
} from '@/common/constants/credential-rules.constant';

export class SetupInstanceDto {
  // Admin user creation
  @IsNotEmpty()
  @IsString()
  @MinLength(USERNAME_MIN_LENGTH, { message: USERNAME_MIN_LENGTH_MESSAGE })
  @MaxLength(USERNAME_MAX_LENGTH, { message: USERNAME_MAX_LENGTH_MESSAGE })
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: USERNAME_PATTERN_MESSAGE })
  adminUsername: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_MIN_LENGTH_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_MAX_LENGTH_MESSAGE })
  adminPassword: string;

  @IsOptional()
  @IsEmail()
  adminEmail?: string;

  // Instance configuration
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  instanceName: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  instanceDescription?: string;

  // Default community setup
  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultCommunityName?: string;

  @IsOptional()
  @IsBoolean()
  createDefaultCommunity?: boolean;

  // Setup token for validation
  @IsNotEmpty()
  @IsString()
  setupToken: string;
}

export class OnboardingStatusDto {
  needsSetup: boolean;
  hasUsers: boolean;
  /**
   * True (the default, REQUIRE_SETUP_TOKEN) when the operator must enter the
   * setup token printed in the backend logs: `setupToken` is then never sent.
   */
  setupTokenRequired: boolean;
  /** Only sent when REQUIRE_SETUP_TOKEN=false and setup is needed. */
  setupToken?: string;
}
