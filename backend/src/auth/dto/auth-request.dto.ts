import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
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
  @ApiPropertyOptional({
    description:
      'The refresh token, for a client that stores its own. Takes precedence over the refresh_token cookie; if it is invalid the request fails, without trying the cookie. The answer has the new refresh token in its body only when the token was presented here.',
  })
  refreshToken?: string;
}

export class LogoutRequestDto {
  @ApiPropertyOptional({
    description:
      'Refresh token, for a client that stores its own instead of using the refresh_token cookie',
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

  @ApiProperty({ enum: ['S256'], enumName: 'CodeChallengeMethod' })
  @IsIn(['S256'])
  codeChallengeMethod: 'S256';

  @ApiProperty({
    description:
      "The account's password: approving a new device needs more than a session.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
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
