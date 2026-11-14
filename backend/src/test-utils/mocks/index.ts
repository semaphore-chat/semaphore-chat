/**
 * Test Mocks
 *
 * Centralized exports for all test mocks.
 *
 * Usage:
 * ```typescript
 * import { createMockDatabase, createMockRedis, createMockSocketClient } from '@/test-utils/mocks';
 * ```
 */

export {
  createMockDatabase,
  resetDatabaseMock,
  createDatabaseProvider,
  type MockDatabaseService,
  type MockPrismaModel,
} from './database.mock';

export {
  createMockRedis,
  resetRedisMock,
  createRedisProvider,
  type MockRedisClient,
} from './redis.mock';

export {
  createMockWebsocketService,
  createMockSocketClient,
  createMockSocketClients,
  resetWebsocketMock,
  createWebsocketProvider,
  type MockWebsocketService,
  type MockSocket,
} from './websocket.mock';

export { createFakeRedis } from './attempt-redis.mock';
