import {
  IsString,
  IsOptional,
  IsEmail,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateUserDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description:
      'Invite code. Required when the instance is invite-only; optional when registration is open.',
  })
  code?: string;

  @IsString()
  @MinLength(USERNAME_MIN_LENGTH, { message: USERNAME_MIN_LENGTH_MESSAGE })
  @MaxLength(USERNAME_MAX_LENGTH, { message: USERNAME_MAX_LENGTH_MESSAGE })
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: USERNAME_PATTERN_MESSAGE,
  })
  username: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_MIN_LENGTH_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_MAX_LENGTH_MESSAGE })
  password: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
