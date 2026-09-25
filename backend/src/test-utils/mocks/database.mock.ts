/**
 * DatabaseService Mock
 *
 * Provides a comprehensive mock of the Prisma client for testing.
 * All methods return jest mock functions that can be configured per test.
 *
 * Usage:
 * ```typescript
 * const mockDatabase = createMockDatabase();
 * mockDatabase.user.findUnique.mockResolvedValue(UserFactory.build());
 *
 * const module = await Test.createTestingModule({
 *   providers: [
 *     MyService,
 *     { provide: DatabaseService, useValue: mockDatabase },
 *   ],
 * }).compile();
 * ```
 */

import { DatabaseService } from '@/database/database.service';

export type MockPrismaModel = {
  findUnique: jest.Mock;
  findUniqueOrThrow: jest.Mock;
  findFirst: jest.Mock;
  findFirstOrThrow: jest.Mock;
  findMany: jest.Mock;
  create: jest.Mock;
  createMany: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
  upsert: jest.Mock;
  delete: jest.Mock;
  deleteMany: jest.Mock;
  count: jest.Mock;
  aggregate: jest.Mock;
  groupBy: jest.Mock;
};

export type MockDatabaseService = {
  // Prisma models
  user: MockPrismaModel;
  message: MockPrismaModel;
  community: MockPrismaModel;
  channel: MockPrismaModel;
  membership: MockPrismaModel;
  channelMembership: MockPrismaModel;
  role: MockPrismaModel;
  userRoles: MockPrismaModel;
  directMessageGroup: MockPrismaModel;
  directMessageGroupMember: MockPrismaModel;
  friendship: MockPrismaModel;
  file: MockPrismaModel;
  refreshToken: MockPrismaModel;
  passwordResetToken: MockPrismaModel;
  instanceInvite: MockPrismaModel;
  instanceSettings: MockPrismaModel;
  aliasGroup: MockPrismaModel;
  aliasGroupMember: MockPrismaModel;
  customEmoji: MockPrismaModel;
  webhook: MockPrismaModel;
  readReceipt: MockPrismaModel;
  notification: MockPrismaModel;
  userNotificationSettings: MockPrismaModel;
  channelNotificationOverride: MockPrismaModel;
  pushSubscription: MockPrismaModel;
  // Moderation models
  threadSubscriber: MockPrismaModel;
  userBlock: MockPrismaModel;
  communityBan: MockPrismaModel;
  communityTimeout: MockPrismaModel;
  moderationLog: MockPrismaModel;
  replayClip: MockPrismaModel;
  soundboardSound: MockPrismaModel;
  // Junction table models (PostgreSQL)
  messageSpan: MockPrismaModel;
  messageReaction: MockPrismaModel;
  messageAttachment: MockPrismaModel;
  instanceInviteUsage: MockPrismaModel;
  instanceInviteDefaultCommunity: MockPrismaModel;

  // Prisma client methods
  $connect: jest.Mock;
  $disconnect: jest.Mock;
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  $on: jest.Mock;

  // NestJS lifecycle methods
  onModuleInit: jest.Mock;
  onModuleDestroy: jest.Mock;
};

function createMockPrismaModel(): MockPrismaModel {
  return {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  };
}

export function createMockDatabase(): MockDatabaseService {
  const mockDb = {
    // All Prisma models
    user: createMockPrismaModel(),
    message: createMockPrismaModel(),
    community: createMockPrismaModel(),
    channel: createMockPrismaModel(),
    membership: createMockPrismaModel(),
    channelMembership: createMockPrismaModel(),
    role: createMockPrismaModel(),
    userRoles: createMockPrismaModel(),
    directMessageGroup: createMockPrismaModel(),
    directMessageGroupMember: createMockPrismaModel(),
    friendship: createMockPrismaModel(),
    file: createMockPrismaModel(),
    refreshToken: createMockPrismaModel(),
    passwordResetToken: createMockPrismaModel(),
    instanceInvite: createMockPrismaModel(),
    instanceSettings: createMockPrismaModel(),
    aliasGroup: createMockPrismaModel(),
    aliasGroupMember: createMockPrismaModel(),
    customEmoji: createMockPrismaModel(),
    webhook: createMockPrismaModel(),
    readReceipt: createMockPrismaModel(),
    notification: createMockPrismaModel(),
    userNotificationSettings: createMockPrismaModel(),
    channelNotificationOverride: createMockPrismaModel(),
    pushSubscription: createMockPrismaModel(),
    threadSubscriber: createMockPrismaModel(),
    userBlock: createMockPrismaModel(),
    // Moderation models
    communityBan: createMockPrismaModel(),
    communityTimeout: createMockPrismaModel(),
    moderationLog: createMockPrismaModel(),
    replayClip: createMockPrismaModel(),
    soundboardSound: createMockPrismaModel(),
    // Junction table models (PostgreSQL)
    messageSpan: createMockPrismaModel(),
    messageReaction: createMockPrismaModel(),
    messageAttachment: createMockPrismaModel(),
    instanceInviteUsage: createMockPrismaModel(),
    instanceInviteDefaultCommunity: createMockPrismaModel(),

    // Prisma client methods
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn((callback) => callback(mockDb)),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $on: jest.fn(),

    // NestJS lifecycle methods
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
  };

  return mockDb;
}

/**
 * Helper to reset all mocks in a database mock instance
 */
export function resetDatabaseMock(mockDatabase: MockDatabaseService): void {
  Object.values(mockDatabase).forEach((value) => {
    if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach((method) => {
        if (jest.isMockFunction(method)) {
          method.mockReset();
        }
      });
    } else if (jest.isMockFunction(value)) {
      value.mockReset();
    }
  });
}

/**
 * Create a mock provider for DatabaseService
 */
export const createDatabaseProvider = (mockDatabase?: MockDatabaseService) => ({
  provide: DatabaseService,
  useValue: mockDatabase || createMockDatabase(),
});
