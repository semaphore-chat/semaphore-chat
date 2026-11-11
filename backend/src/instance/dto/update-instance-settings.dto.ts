import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  IsNumber,
  Min,
} from 'class-validator';
import { RegistrationMode } from '@prisma/client';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RegistrationModeValues } from '@/common/enums/swagger-enums';

export class UpdateInstanceSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    enum: RegistrationModeValues,
    enumName: 'RegistrationMode',
    required: false,
  })
  @IsOptional()
  @IsEnum(RegistrationMode)
  registrationMode?: RegistrationMode;

  /**
   * Default storage quota for new users in bytes
   * Minimum: 0 (no storage allowed)
   * Example: 53687091200 = 50GB
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  defaultStorageQuotaBytes?: number;

  /**
   * Maximum file size allowed for uploads in bytes
   * Minimum: 0 (no uploads allowed)
   * Example: 524288000 = 500MB
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  maxFileSizeBytes?: number;
}
