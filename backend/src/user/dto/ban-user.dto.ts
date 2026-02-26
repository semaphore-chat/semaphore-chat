import { IsBoolean } from 'class-validator';

export class SetUserBanStatusDto {
  @IsBoolean()
  banned: boolean;
}
