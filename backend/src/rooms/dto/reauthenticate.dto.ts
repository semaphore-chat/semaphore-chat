import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReauthenticateDto {
  /** The new access token, with or without the `Bearer ` prefix. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  token: string;
}
