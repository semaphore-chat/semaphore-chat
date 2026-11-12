import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { RegistrationMode } from '@prisma/client';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RegistrationModeValues } from '@/common/enums/swagger-enums';
import {
  MAX_FILE_SIZE_BYTES,
  MIN_FILE_SIZE_BYTES,
  MIN_STORAGE_QUOTA_BYTES,
} from '@/common/constants/storage-limits.constant';

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
   * Default storage quota for new users in bytes.
   * Example: 53687091200 = 50GB
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(MIN_STORAGE_QUOTA_BYTES)
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  defaultStorageQuotaBytes?: number;

  /**
   * Maximum file size allowed for uploads in bytes.
   * Example: 524288000 = 500MB
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(MIN_FILE_SIZE_BYTES)
  @Max(MAX_FILE_SIZE_BYTES)
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  maxFileSizeBytes?: number;
}
