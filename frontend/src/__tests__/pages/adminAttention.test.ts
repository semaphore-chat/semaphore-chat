import { describe, it, expect } from 'vitest';
import {
  getAttentionItems,
  diskSeverity,
  LIVEKIT_SETUP_DOCS_URL,
} from '../../pages/admin/adminAttention';
import type { InstanceStorageStatsDto } from '../../api-client/types.gen';

const storage = (
  overrides: Partial<InstanceStorageStatsDto> = {},
  server: Partial<InstanceStorageStatsDto['server']> = {},
): InstanceStorageStatsDto => ({
  totalStorageUsedBytes: 1024,
  totalFileCount: 1,
  totalUserCount: 1,
  averageStoragePerUserBytes: 1024,
  userStorageDistribution: { under25Percent: 1, under50Percent: 0, under75Percent: 0, under90Percent: 0, over90Percent: 0 },
  storageByType: [],
  defaultQuotaBytes: 1024 ** 3,
  maxFileSizeBytes: 1024 ** 2,
  usersApproachingQuota: 0,
  usersOverQuota: 0,
  ...overrides,
  server: {
    memoryTotalBytes: 100,
    memoryUsedBytes: 99,
    memoryFreeBytes: 1,
    memoryUsedPercent: 99,
    cpuCores: 4,
    cpuModel: 'cpu',
    loadAverage: [9, 9, 9],
    diskTotalBytes: 100,
    diskUsedBytes: 10,
    diskFreeBytes: 90,
    diskUsedPercent: 10,
    platform: 'linux',
    hostname: 'h',
    uptime: 1,
    ...server,
  },
});

const ids = (items: ReturnType<typeof getAttentionItems>) => items.map((i) => i.id);

describe('diskSeverity', () => {
  it.each([
    [79.99, null],
    [80, 'warning'],
    [89.99, 'warning'],
    [90, 'error'],
    [100, 'error'],
  ])('%s%% -> %s', (percent, expected) => {
    expect(diskSeverity(percent)).toBe(expected);
  });
});

describe('getAttentionItems', () => {
  it('is empty when everything is fine, even with high memory and load', () => {
    expect(getAttentionItems({ storage: storage(), livekit: { status: 'healthy', configured: true } })).toEqual([]);
  });

  it('is empty before anything has loaded', () => {
    expect(getAttentionItems({})).toEqual([]);
  });

  it('flags disk at 80% as a warning that links to storage', () => {
    const [item] = getAttentionItems({ storage: storage({}, { diskUsedPercent: 80 }) });
    expect(item).toMatchObject({ id: 'disk', severity: 'warning', to: '/admin/storage', title: 'Server disk is 80% full' });
  });

  it('flags disk at 90% as an error', () => {
    expect(getAttentionItems({ storage: storage({}, { diskUsedPercent: 93.4 }) })[0]).toMatchObject({
      id: 'disk',
      severity: 'error',
      title: 'Server disk is 93% full',
    });
  });

  it('ignores disk use when the server could not measure the disk', () => {
    expect(getAttentionItems({ storage: storage({}, { diskTotalBytes: 0, diskUsedPercent: 95 }) })).toEqual([]);
  });

  it('flags users over 90% of quota with a deep link to the filtered storage list', () => {
    const [item] = getAttentionItems({ storage: storage({ usersOverQuota: 3 }) });
    expect(item).toMatchObject({
      id: 'over-quota',
      severity: 'warning',
      to: '/admin/storage?minPercent=90',
      title: '3 users are over 90% of their storage quota',
    });
    expect(getAttentionItems({ storage: storage({ usersOverQuota: 1 }) })[0].title).toBe(
      '1 user is over 90% of their storage quota',
    );
  });

  it('does not flag users approaching their quota', () => {
    expect(getAttentionItems({ storage: storage({ usersApproachingQuota: 12 }) })).toEqual([]);
  });

  it('flags a storage stats failure as a retryable item without a link', () => {
    const [item] = getAttentionItems({ storageError: true });
    expect(item).toMatchObject({ id: 'storage-unavailable', severity: 'warning', actionLabel: 'Try again' });
    expect(item.to).toBeUndefined();
    expect(item.href).toBeUndefined();
  });

  it('flags an unconfigured LiveKit with the setup docs link, worded as optional', () => {
    const [item] = getAttentionItems({ livekit: { status: 'unhealthy', configured: false } });
    expect(item).toMatchObject({
      id: 'livekit',
      severity: 'warning',
      href: LIVEKIT_SETUP_DOCS_URL,
      title: "Voice and video are off: LiveKit isn't configured",
    });
    expect(item.detail).toMatch(/Text chat works without it/);
  });

  it('puts errors before warnings', () => {
    const items = getAttentionItems({
      storage: storage({ usersOverQuota: 2 }, { diskUsedPercent: 95 }),
      livekit: { status: 'unhealthy', configured: false },
    });
    expect(ids(items)).toEqual(['disk', 'over-quota', 'livekit']);
    expect(items[0].severity).toBe('error');
  });
});
