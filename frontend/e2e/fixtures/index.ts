/**
 * E2E Test Fixtures
 *
 * Re-exports all fixtures for convenient importing.
 *
 * Usage:
 * ```ts
 * import { test, expect, TEST_USER, createTestCommunity } from './fixtures';
 * ```
 */

export { test, expect, TEST_USER, TEST_USER_2, API_BASE } from './auth.fixture';
export {
  loginViaApi,
  registerViaApi,
  setAuthToken,
  clearAuthToken,
  isAuthenticated,
} from './auth.fixture';

export {
  createTestCommunity,
  createTestChannel,
  sendTestMessage,
  createCommunityInvite,
  getUserCommunities,
  deleteCommunity,
  generateTestName,
  waitForMessage,
  cleanupTestCommunities,
} from './test-data';

export {
  MEMBER_USER,
  DESKTOP_VIEWPORT,
  openSession,
  createWorld,
  sendSpans,
  shot,
  channelUrl,
} from './release';
export type { Session, ReleaseWorld } from './release';
