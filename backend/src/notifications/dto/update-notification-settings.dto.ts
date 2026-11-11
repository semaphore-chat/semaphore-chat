import {
  IsBoolean,
  IsOptional,
  IsString,
  IsIn,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  NotificationLevelValues,
  NotificationSoundTypeValues,
} from '@/common/enums/swagger-enums';

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  desktopEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  playSound?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['default', 'mention', 'dm'])
  @ApiPropertyOptional({
    enum: NotificationSoundTypeValues,
    enumName: 'NotificationSoundType',
  })
  soundType?: string;

  @IsOptional()
  @IsBoolean()
  doNotDisturb?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'dndStartTime must be in HH:mm format (24-hour)',
  })
  dndStartTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'dndEndTime must be in HH:mm format (24-hour)',
  })
  dndEndTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/, {
    message: 'dndTimezone must be an IANA timezone name (e.g. Europe/Berlin)',
  })
  dndTimezone?: string;

  @IsOptional()
  @IsString()
  @IsIn(['all', 'mentions', 'none'])
  @ApiPropertyOptional({
    enum: NotificationLevelValues,
    enumName: 'NotificationLevel',
  })
  defaultChannelLevel?: string;

  @IsOptional()
  @IsBoolean()
  dmNotifications?: boolean;
}
