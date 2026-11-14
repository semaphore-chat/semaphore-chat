import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as os from 'os';
import { execSync } from 'child_process';
import { DatabaseService } from '@/database/database.service';
import {
  UserStorageStatsDto,
  InstanceStorageStatsDto,
  StorageByTypeDto,
  QuotaCheckResultDto,
  ServerStatsDto,
} from './dto/storage-stats.dto';

@Injectable()
export class StorageQuotaService {
  private readonly logger = new Logger(StorageQuotaService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Get storage stats for a specific user
   */
  async getUserStorageStats(userId: string): Promise<UserStorageStatsDto> {
    const [user, fileStats] = await Promise.all([
      this.db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          storageQuotaBytes: true,
          storageUsedBytes: true,
        },
      }),
      this.db.file.aggregate({
        where: {
          uploadedById: userId,
          deletedAt: null,
        },
        _sum: { size: true },
        _count: true,
      }),
    ]);

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const usedBytes = Number(user.storageUsedBytes);
    const quotaBytes = Number(user.storageQuotaBytes);
    const percentUsed = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;

    return {
      userId,
      username: user.username,
      usedBytes,
      quotaBytes,
      percentUsed: Math.round(percentUsed * 100) / 100,
      fileCount: fileStats._count,
    };
  }

  /**
   * Check if user can upload a file of given size
   */
  async canUploadFile(
    userId: string,
    fileSizeBytes: number,
  ): Promise<QuotaCheckResultDto> {
    const [user, instanceSettings] = await Promise.all([
      this.db.user.findUnique({
        where: { id: userId },
        select: {
          storageQuotaBytes: true,
          storageUsedBytes: true,
        },
      }),
      this.getInstanceStorageSettings(),
    ]);

    if (!user) {
      return {
        canUpload: false,
        currentUsedBytes: 0,
        quotaBytes: 0,
        requestedBytes: fileSizeBytes,
        remainingBytes: 0,
        message: 'User not found',
      };
    }

    const currentUsedBytes = Number(user.storageUsedBytes);
    const quotaBytes = Number(user.storageQuotaBytes);
    const maxFileSizeBytes = Number(instanceSettings.maxFileSizeBytes);
    const remainingBytes = quotaBytes - currentUsedBytes;

    // Check max file size limit
    if (fileSizeBytes > maxFileSizeBytes) {
      return {
        canUpload: false,
        currentUsedBytes,
        quotaBytes,
        requestedBytes: fileSizeBytes,
        remainingBytes,
        message: `File exceeds maximum size of ${this.formatBytes(maxFileSizeBytes)}`,
      };
    }

    // Check quota
    if (currentUsedBytes + fileSizeBytes > quotaBytes) {
      return {
        canUpload: false,
        currentUsedBytes,
        quotaBytes,
        requestedBytes: fileSizeBytes,
        remainingBytes,
        message: `Upload would exceed storage quota. ${this.formatBytes(remainingBytes)} remaining`,
      };
    }

    return {
      canUpload: true,
      currentUsedBytes,
      quotaBytes,
      requestedBytes: fileSizeBytes,
      remainingBytes,
    };
  }

  /**
   * Whether `bytes` more fit the user's quota. For files the server itself
   * writes (replay clips): those answer to the quota, not to the upload size
   * limit that canUploadFile also applies.
   */
  async fitsQuota(userId: string, bytes: number): Promise<boolean> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { storageQuotaBytes: true, storageUsedBytes: true },
    });
    if (!user) return false;
    const used = Number(user.storageUsedBytes);
    const quota = Number(user.storageQuotaBytes);
    return bytes === 0 ? used < quota : used + bytes <= quota;
  }

  /**
   * Increment user's storage usage after successful upload
   */
  async incrementUserStorage(userId: string, bytes: number): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data: {
        storageUsedBytes: {
          increment: bytes,
        },
      },
    });
  }

  /**
   * Add `bytes` to the user's usage only if they still fit the quota, as one
   * conditional update, so concurrent uploads can't all pass a check made
   * before any of them is counted. Release with decrementUserStorage if the
   * upload then fails.
   *
   * @returns false when the bytes don't fit (or the user doesn't exist)
   */
  async reserveStorage(userId: string, bytes: number): Promise<boolean> {
    const size = BigInt(bytes);
    const updated = await this.db.$executeRaw`
      UPDATE "User"
      SET "storageUsedBytes" = "storageUsedBytes" + ${size}
      WHERE "id" = ${userId}
        AND "storageUsedBytes" + ${size} <= "storageQuotaBytes"`;
    return updated > 0;
  }

  /**
   * Decrement user's storage usage after file deletion (or to release a
   * reservation). One statement, so it can't overwrite a concurrent change;
   * never goes below zero.
   */
  async decrementUserStorage(userId: string, bytes: number): Promise<void> {
    await this.db.$executeRaw`
      UPDATE "User"
      SET "storageUsedBytes" = GREATEST(0, "storageUsedBytes" - ${BigInt(bytes)})
      WHERE "id" = ${userId}`;
  }

  /**
   * Recalculate user's storage usage from actual files
   */
  async recalculateUserStorage(userId: string): Promise<UserStorageStatsDto> {
    const fileStats = await this.db.file.aggregate({
      where: {
        uploadedById: userId,
        deletedAt: null,
      },
      _sum: { size: true },
      _count: true,
    });

    const actualUsage = fileStats._sum.size || 0;

    await this.db.user.update({
      where: { id: userId },
      data: {
        storageUsedBytes: actualUsage,
      },
    });

    return this.getUserStorageStats(userId);
  }

  /**
   * Update user's storage quota
   */
  async updateUserQuota(
    userId: string,
    quotaBytes: number,
  ): Promise<UserStorageStatsDto> {
    await this.db.user.update({
      where: { id: userId },
      data: {
        storageQuotaBytes: quotaBytes,
      },
    });

    return this.getUserStorageStats(userId);
  }

  /**
   * Get instance-wide storage statistics (aggregate, privacy-conscious)
   */
  async getInstanceStorageStats(): Promise<InstanceStorageStatsDto> {
    const [
      instanceSettings,
      totalFiles,
      totalUsers,
      storageByTypeRaw,
      userDistribution,
    ] = await Promise.all([
      this.getInstanceStorageSettings(),
      this.db.file.aggregate({
        where: { deletedAt: null },
        _sum: { size: true },
        _count: true,
      }),
      this.db.user.count(),
      this.getStorageByType(),
      this.getUserStorageDistribution(),
    ]);

    const serverStats = this.getServerStats();

    const totalStorageUsedBytes = totalFiles._sum.size || 0;
    const totalFileCount = totalFiles._count;
    const averageStoragePerUserBytes =
      totalUsers > 0 ? Math.round(totalStorageUsedBytes / totalUsers) : 0;

    return {
      totalStorageUsedBytes,
      totalFileCount,
      totalUserCount: totalUsers,
      averageStoragePerUserBytes,
      userStorageDistribution: userDistribution,
      storageByType: storageByTypeRaw,
      defaultQuotaBytes: Number(instanceSettings.defaultStorageQuotaBytes),
      maxFileSizeBytes: Number(instanceSettings.maxFileSizeBytes),
      usersApproachingQuota: userDistribution.under90Percent, // 75-90%
      usersOverQuota: userDistribution.over90Percent,
      server: serverStats,
    };
  }

  /**
   * Get server hardware statistics
   */
  private getServerStats(): ServerStatsDto {
    // Memory stats
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // CPU info
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown';
    const loadAvg = os.loadavg();

    // Disk stats (try to get using df command)
    let diskStats = { total: 0, used: 0, free: 0 };
    try {
      const dfOutput = execSync('df -B1 / 2>/dev/null', { encoding: 'utf-8' });
      const lines = dfOutput.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 4) {
          diskStats = {
            total: parseInt(parts[1], 10) || 0,
            used: parseInt(parts[2], 10) || 0,
            free: parseInt(parts[3], 10) || 0,
          };
        }
      }
    } catch {
      // df not available or failed, return zeros
      this.logger.debug('Could not get disk stats via df command');
    }

    return {
      memoryTotalBytes: totalMem,
      memoryUsedBytes: usedMem,
      memoryFreeBytes: freeMem,
      memoryUsedPercent: Math.round((usedMem / totalMem) * 100 * 100) / 100,
      cpuCores: cpus.length,
      cpuModel,
      loadAverage: loadAvg,
      diskTotalBytes: diskStats.total,
      diskUsedBytes: diskStats.used,
      diskFreeBytes: diskStats.free,
      diskUsedPercent:
        diskStats.total > 0
          ? Math.round((diskStats.used / diskStats.total) * 100 * 100) / 100
          : 0,
      platform: os.platform(),
      hostname: os.hostname(),
      uptime: os.uptime(),
    };
  }

  /**
   * Get storage breakdown by resource type
   */
  private async getStorageByType(): Promise<StorageByTypeDto[]> {
    const results = await this.db.file.groupBy({
      by: ['resourceType'],
      where: { deletedAt: null },
      _sum: { size: true },
      _count: true,
    });

    return results.map((r) => ({
      type: r.resourceType,
      bytes: r._sum.size || 0,
      count: r._count,
    }));
  }

  /**
   * Get user storage distribution (aggregate buckets, not individual values)
   */
  private async getUserStorageDistribution(): Promise<{
    under25Percent: number;
    under50Percent: number;
    under75Percent: number;
    under90Percent: number;
    over90Percent: number;
  }> {
    // Get all users with their usage percentages
    const users = await this.db.user.findMany({
      select: {
        storageQuotaBytes: true,
        storageUsedBytes: true,
      },
    });

    const distribution = {
      under25Percent: 0,
      under50Percent: 0,
      under75Percent: 0,
      under90Percent: 0,
      over90Percent: 0,
    };

    for (const user of users) {
      const quota = Number(user.storageQuotaBytes);
      const used = Number(user.storageUsedBytes);
      const percentUsed = quota > 0 ? (used / quota) * 100 : 0;

      if (percentUsed < 25) {
        distribution.under25Percent++;
      } else if (percentUsed < 50) {
        distribution.under50Percent++;
      } else if (percentUsed < 75) {
        distribution.under75Percent++;
      } else if (percentUsed < 90) {
        distribution.under90Percent++;
      } else {
        distribution.over90Percent++;
      }
    }

    return distribution;
  }

  /**
   * Get instance storage settings
   */
  private async getInstanceStorageSettings(): Promise<{
    defaultStorageQuotaBytes: bigint;
    maxFileSizeBytes: bigint;
  }> {
    let settings = await this.db.instanceSettings.findFirst({
      select: {
        defaultStorageQuotaBytes: true,
        maxFileSizeBytes: true,
      },
    });

    if (!settings) {
      // Create default settings
      const created = await this.db.instanceSettings.create({
        data: {
          name: 'Semaphore Chat',
          defaultStorageQuotaBytes: BigInt(53687091200), // 50GB
          maxFileSizeBytes: BigInt(524288000), // 500MB
        },
      });
      settings = {
        defaultStorageQuotaBytes: created.defaultStorageQuotaBytes,
        maxFileSizeBytes: created.maxFileSizeBytes,
      };
    }

    return settings;
  }

  /**
   * Update instance storage settings
   */
  async updateStorageSettings(
    defaultStorageQuotaBytes?: number,
    maxFileSizeBytes?: number,
  ): Promise<void> {
    const existing = await this.db.instanceSettings.findFirst();
    if (!existing) {
      await this.db.instanceSettings.create({
        data: {
          name: 'Semaphore Chat',
          ...(defaultStorageQuotaBytes !== undefined && {
            defaultStorageQuotaBytes,
          }),
          ...(maxFileSizeBytes !== undefined && { maxFileSizeBytes }),
        },
      });
    } else {
      await this.db.instanceSettings.update({
        where: { id: existing.id },
        data: {
          ...(defaultStorageQuotaBytes !== undefined && {
            defaultStorageQuotaBytes,
          }),
          ...(maxFileSizeBytes !== undefined && { maxFileSizeBytes }),
        },
      });
    }
  }

  /**
   * Get users sorted by storage usage (for admin table)
   */
  async getUsersStorageList(options: {
    skip?: number;
    take?: number;
    sortBy?: 'usedBytes' | 'percentUsed';
    sortOrder?: 'asc' | 'desc';
    minPercentUsed?: number;
  }): Promise<{ users: UserStorageStatsDto[]; total: number }> {
    const { skip = 0, take = 50, minPercentUsed } = options;

    // Get all users with storage info
    const users = await this.db.user.findMany({
      select: {
        id: true,
        username: true,
        storageQuotaBytes: true,
        storageUsedBytes: true,
        _count: {
          select: {
            File: {
              where: {
                deletedAt: null,
              },
            },
          },
        },
      },
    });

    // Calculate percentages and filter
    let processed = users.map((u) => {
      const usedBytes = Number(u.storageUsedBytes);
      const quotaBytes = Number(u.storageQuotaBytes);
      const percentUsed = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;

      return {
        userId: u.id,
        username: u.username,
        usedBytes,
        quotaBytes,
        percentUsed: Math.round(percentUsed * 100) / 100,
        fileCount: u._count.File,
      };
    });

    // Filter by minimum percentage if specified
    if (minPercentUsed !== undefined) {
      processed = processed.filter((u) => u.percentUsed >= minPercentUsed);
    }

    // Sort by percentage used (descending by default)
    processed.sort((a, b) => b.percentUsed - a.percentUsed);

    const total = processed.length;

    // Paginate
    const paginated = processed.slice(skip, skip + take);

    return { users: paginated, total };
  }

  /**
   * Recalculate storage for all users (maintenance task)
   * Runs daily at 3 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async recalculateAllUsersStorage(): Promise<void> {
    this.logger.log('Starting daily storage recalculation for all users...');

    const users = await this.db.user.findMany({
      select: { id: true },
    });

    let updated = 0;
    for (const user of users) {
      try {
        await this.recalculateUserStorage(user.id);
        updated++;
      } catch (error) {
        this.logger.error(
          `Failed to recalculate storage for user ${user.id}:`,
          error,
        );
      }
    }

    this.logger.log(
      `Storage recalculation complete. Updated ${updated}/${users.length} users.`,
    );
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let size = bytes;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}
