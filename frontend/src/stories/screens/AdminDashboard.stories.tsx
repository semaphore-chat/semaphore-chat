import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario } from '../fixtures/scenarios';
import { withErrors, withSlowEndpoint } from '../fixtures/handlerHelpers';
import {
  adminStorageStats,
  diskAt,
  livekitUnconfiguredHandler,
  statsHandler,
  storageHandler,
} from '../fixtures/adminDashboard';

/** Instance dashboard with nothing to fix: the "All good" line, neutral tiles, storage panel. */
export const AdminDashboard = defineScreen(bigCommunityScenario, '/admin');

/** One warning: the server disk is 84% full. */
export const AdminDashboardOneIssue = defineScreen(bigCommunityScenario, '/admin', {
  extraHandlers: [storageHandler(adminStorageStats({}, diskAt(84)))],
});

/** Several items, the error (disk 95%) first: users over quota, LiveKit not configured. */
export const AdminDashboardSeveralIssues = defineScreen(bigCommunityScenario, '/admin', {
  extraHandlers: [
    storageHandler(adminStorageStats({ usersOverQuota: 3, usersApproachingQuota: 7 }, diskAt(95))),
    livekitUnconfiguredHandler,
  ],
});

/** Stats still loading: skeleton tiles and a skeleton storage panel. */
export const AdminDashboardLoading = defineScreen(bigCommunityScenario, '/admin', {
  extraHandlers: [
    withSlowEndpoint('get', '/api/instance/stats', 600_000),
    withSlowEndpoint('get', '/api/storage/instance', 600_000),
  ],
});

/** The stats call fails: the page-level error with a retry. */
export const AdminDashboardError = defineScreen(bigCommunityScenario, '/admin', {
  extraHandlers: [withErrors('get', '/api/instance/stats', 500)],
});

/** Only the storage/server stats fail: a retryable attention item, totals still shown. */
export const AdminDashboardStorageError = defineScreen(bigCommunityScenario, '/admin', {
  extraHandlers: [withErrors('get', '/api/storage/instance', 500)],
});

/** A big instance: counts in the millions and billions, a multi-TB disk, many over-quota users. */
export const AdminDashboardLongNumbers = defineScreen(bigCommunityScenario, '/admin', {
  extraHandlers: [
    statsHandler({
      totalUsers: 2_345_678,
      totalCommunities: 987_654,
      totalChannels: 12_345_678,
      totalMessages: 9_876_543_210,
      activeInvites: 123_456,
      bannedUsers: 45_678,
    }),
    storageHandler(
      adminStorageStats(
        {
          totalStorageUsedBytes: 3.7 * 1024 ** 4,
          totalFileCount: 48_765_432,
          usersOverQuota: 12_345,
          usersApproachingQuota: 54_321,
        },
        {
          diskTotalBytes: 8 * 1024 ** 4,
          diskUsedBytes: 6.6 * 1024 ** 4,
          diskFreeBytes: 1.4 * 1024 ** 4,
          diskUsedPercent: 82.5,
          hostname: 'semaphore-backend-7d9f8c6b5d-x2k9p.prod-cluster.internal',
        },
      ),
    ),
  ],
});

/** Admin community table — community avatars are file ids resolved via AuthenticatedImage. */
export const AdminCommunities = defineScreen(bigCommunityScenario, '/admin/communities');

/** Deep link from the dashboard's "Banned users" tile: the users page opens with the Banned filter set. */
export const AdminUsersBannedDeepLink = defineScreen(bigCommunityScenario, '/admin/users?status=banned');

/** Deep link from the over-quota attention item: the storage page opens filtered to users at 90%+. */
export const AdminStorageOverQuotaDeepLink = defineScreen(bigCommunityScenario, '/admin/storage?minPercent=90');
