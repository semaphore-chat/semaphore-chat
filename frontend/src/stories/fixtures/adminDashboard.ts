/**
 * Handlers for the admin dashboard stories (`screens/AdminDashboard.stories.tsx`):
 * instance stats, storage/server stats and LiveKit health, each overridable so a
 * story can put the dashboard into a "needs attention" state.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type {
  InstanceStatsResponseDto,
  InstanceStorageStatsDto,
  LivekitHealthResponseDto,
} from '../../api-client/types.gen';

const GB = 1024 ** 3;

export function adminStorageStats(
  overrides: Partial<Omit<InstanceStorageStatsDto, 'server'>> = {},
  server: Partial<InstanceStorageStatsDto['server']> = {},
): InstanceStorageStatsDto {
  return {
    totalStorageUsedBytes: 4.2 * GB,
    totalFileCount: 128,
    totalUserCount: 13,
    averageStoragePerUserBytes: 320 * 1024 ** 2,
    userStorageDistribution: { under25Percent: 10, under50Percent: 2, under75Percent: 1, under90Percent: 0, over90Percent: 0 },
    storageByType: [
      { type: 'IMAGE', bytes: 2.1 * GB, count: 80 },
      { type: 'VIDEO', bytes: 1.8 * GB, count: 12 },
      { type: 'DOCUMENT', bytes: 0.3 * GB, count: 36 },
    ],
    defaultQuotaBytes: 5 * GB,
    maxFileSizeBytes: 25 * 1024 ** 2,
    usersApproachingQuota: 0,
    usersOverQuota: 0,
    ...overrides,
    server: {
      memoryTotalBytes: 16 * GB,
      memoryUsedBytes: 6 * GB,
      memoryFreeBytes: 10 * GB,
      memoryUsedPercent: 37.5,
      cpuCores: 8,
      cpuModel: 'Ladle Sandbox vCPU',
      loadAverage: [0.5, 0.4, 0.3],
      diskTotalBytes: 512 * GB,
      diskUsedBytes: 128 * GB,
      diskFreeBytes: 384 * GB,
      diskUsedPercent: 25,
      platform: 'linux',
      hostname: 'ladle-sandbox',
      uptime: 3600 * 24 * 3,
      ...server,
    },
  };
}

/** Server disk at `percent` of a 512 GB disk. */
export const diskAt = (percent: number): Partial<InstanceStorageStatsDto['server']> => {
  const total = 512 * GB;
  const used = Math.round((total * percent) / 100);
  return { diskTotalBytes: total, diskUsedBytes: used, diskFreeBytes: total - used, diskUsedPercent: percent };
};

export const storageHandler = (stats: InstanceStorageStatsDto): HttpHandler =>
  http.get('/api/storage/instance', () => HttpResponse.json(stats));

export const statsHandler = (stats: InstanceStatsResponseDto): HttpHandler =>
  http.get('/api/instance/stats', () => HttpResponse.json(stats));

export const livekitUnconfiguredHandler: HttpHandler = http.get('/api/livekit/health', () =>
  HttpResponse.json({ status: 'unhealthy', configured: false } satisfies LivekitHealthResponseDto),
);
