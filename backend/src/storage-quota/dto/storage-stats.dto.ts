import { IsNumber, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MAX_FILE_SIZE_BYTES,
  MIN_FILE_SIZE_BYTES,
  MIN_STORAGE_QUOTA_BYTES,
} from '@/common/constants/storage-limits.constant';

/**
 * User storage stats response
 */
export class UserStorageStatsDto {
  userId: string;
  username: string;
  @ApiProperty({ type: 'integer', format: 'int64' })
  usedBytes: number;
  @ApiProperty({ type: 'integer', format: 'int64' })
  quotaBytes: number;
  percentUsed: number;
  @ApiProperty({ type: 'integer' })
  fileCount: number;
}

/**
 * Paginated user storage list response
 */
export class UserStorageListResponseDto {
  @ApiProperty({ type: [UserStorageStatsDto] })
  users: UserStorageStatsDto[];
  @ApiProperty({ type: 'integer' })
  total: number;
}

/**
 * Server hardware stats
 */
export class ServerStatsDto {
  // Memory
  @ApiProperty({ type: 'integer', format: 'int64' })
  memoryTotalBytes: number;
  @ApiProperty({ type: 'integer', format: 'int64' })
  memoryUsedBytes: number;
  @ApiProperty({ type: 'integer', format: 'int64' })
  memoryFreeBytes: number;
  memoryUsedPercent: number;

  // CPU
  @ApiProperty({ type: 'integer' })
  cpuCores: number;
  cpuModel: string;
  loadAverage: number[]; // 1, 5, 15 minute averages

  // Disk (root filesystem)
  @ApiProperty({ type: 'integer', format: 'int64' })
  diskTotalBytes: number;
  @ApiProperty({ type: 'integer', format: 'int64' })
  diskUsedBytes: number;
  @ApiProperty({ type: 'integer', format: 'int64' })
  diskFreeBytes: number;
  diskUsedPercent: number;

  // System info
  platform: string;
  hostname: string;
  uptime: number; // seconds
}

/**
 * Storage distribution by usage percentage
 */
export class StorageDistributionDto {
  @ApiProperty({ type: 'integer' })
  under25Percent: number;
  @ApiProperty({ type: 'integer' })
  under50Percent: number;
  @ApiProperty({ type: 'integer' })
  under75Percent: number;
  @ApiProperty({ type: 'integer' })
  under90Percent: number;
  @ApiProperty({ type: 'integer' })
  over90Percent: number;
}

/**
 * Storage breakdown by resource type
 */
export class StorageByTypeDto {
  type: string;
  @ApiProperty({ type: 'integer', format: 'int64' })
  bytes: number;
  @ApiProperty({ type: 'integer' })
  count: number;
}

/**
 * Instance-wide storage statistics (aggregate, privacy-conscious)
 */
export class InstanceStorageStatsDto {
  // Totals
  @ApiProperty({ type: 'integer', format: 'int64' })
  totalStorageUsedBytes: number;
  @ApiProperty({ type: 'integer' })
  totalFileCount: number;
  @ApiProperty({ type: 'integer' })
  totalUserCount: number;

  // Averages
  @ApiProperty({ type: 'integer', format: 'int64' })
  averageStoragePerUserBytes: number;

  // Distribution (aggregate, not individual)
  userStorageDistribution: StorageDistributionDto;

  // Breakdown by type
  storageByType: StorageByTypeDto[];

  // Instance settings
  @ApiProperty({ type: 'integer', format: 'int64' })
  defaultQuotaBytes: number;
  @ApiProperty({ type: 'integer', format: 'int64' })
  maxFileSizeBytes: number;

  // Health indicators
  @ApiProperty({ type: 'integer' })
  usersApproachingQuota: number; // > 75%
  @ApiProperty({ type: 'integer' })
  usersOverQuota: number; // > 90%

  // Server hardware stats
  server: ServerStatsDto;
}

/**
 * Update user quota request
 */
export class UpdateUserQuotaDto {
  @IsNumber()
  @Min(0)
  @ApiProperty({ type: 'integer', format: 'int64' })
  quotaBytes: number;
}

/**
 * Update instance storage settings request
 */
export class UpdateStorageSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(MIN_STORAGE_QUOTA_BYTES)
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  defaultStorageQuotaBytes?: number;

  @IsOptional()
  @IsNumber()
  @Min(MIN_FILE_SIZE_BYTES)
  @Max(MAX_FILE_SIZE_BYTES)
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  maxFileSizeBytes?: number;
}

/**
 * Storage quota check result
 */
export class QuotaCheckResultDto {
  canUpload: boolean;
  @ApiProperty({ type: 'integer', format: 'int64' })
  currentUsedBytes: number;
  @ApiProperty({ type: 'integer', format: 'int64' })
  quotaBytes: number;
  @ApiProperty({ type: 'integer', format: 'int64' })
  requestedBytes: number;
  @ApiProperty({ type: 'integer', format: 'int64' })
  remainingBytes: number;
  message?: string;
}
