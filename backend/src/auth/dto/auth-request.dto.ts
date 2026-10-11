import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class LoginRequestDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RefreshRequestDto {
  @ApiPropertyOptional()
  refreshToken?: string;
}

export class LogoutRequestDto {
  @ApiPropertyOptional({
    description:
      'Refresh token (required for Electron clients that cannot use cookies)',
  })
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

export class AuthorizeDesktopLoginRequestDto {
  @ApiProperty({
    description:
      "PKCE S256 code challenge: base64url SHA-256 of the desktop app's code verifier",
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  codeChallenge: string;

  @ApiProperty({ enum: ['S256'] })
  @IsIn(['S256'])
  codeChallengeMethod: 'S256';
}

export class DesktopLoginTokenRequestDto {
  @ApiProperty({ description: 'The code from POST /auth/desktop/authorize' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  code: string;

  @ApiProperty({
    description: 'The PKCE code verifier the challenge came from',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9\-._~]{43,128}$/)
  codeVerifier: string;
}
