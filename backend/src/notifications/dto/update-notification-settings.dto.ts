import {
  IsBoolean,
  IsOptional,
  IsString,
  IsIn,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  NotificationLevelValues,
  NotificationSoundTypeValues,
} from '@/common/enums/swagger-enums';

/** An empty string clears the field, like an explicit JSON null. */
const emptyToNull = ({ value }: { value: unknown }) =>
  value === '' ? null : value;

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
  @Transform(emptyToNull)
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'dndStartTime must be in HH:mm format (24-hour)',
  })
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Start of the DND window, HH:mm (24-hour). null or an empty string clears it.',
  })
  dndStartTime?: string | null;

  @IsOptional()
  @IsString()
  @Transform(emptyToNull)
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'dndEndTime must be in HH:mm format (24-hour)',
  })
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'End of the DND window, HH:mm (24-hour). null or an empty string clears it.',
  })
  dndEndTime?: string | null;

  @IsOptional()
  @IsString()
  @Transform(emptyToNull)
  @Matches(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/, {
    message: 'dndTimezone must be an IANA timezone name (e.g. Europe/Berlin)',
  })
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'IANA timezone for the DND window. null or an empty string clears it.',
  })
  dndTimezone?: string | null;

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
