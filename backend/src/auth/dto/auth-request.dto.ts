import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

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
  refreshToken?: string;
}
