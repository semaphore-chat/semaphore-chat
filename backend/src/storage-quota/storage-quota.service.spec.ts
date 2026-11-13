import { TestBed } from '@suites/unit';
import { StorageQuotaService } from './storage-quota.service';
import { DatabaseService } from '@/database/database.service';
import { createMockDatabase, UserFactory } from '@/test-utils';

describe('StorageQuotaService', () => {
  let service: StorageQuotaService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit } = await TestBed.solitary(StorageQuotaService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserStorageStats', () => {
    const userId = 'user-123';

    it('should return user storage stats with percentage', async () => {
      const user = UserFactory.build({
        id: userId,
        username: 'testuser',
        storageQuotaBytes: BigInt(1000000),
        storageUsedBytes: BigInt(500000),
      });

      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.file.aggregate.mockResolvedValue({
        _sum: { size: 500000 },
        _count: 10,
      });

      const result = await service.getUserStorageStats(userId);

      expect(result.userId).toBe(userId);
      expect(result.username).toBe('testuser');
      expect(result.usedBytes).toBe(500000);
      expect(result.quotaBytes).toBe(1000000);
      expect(result.percentUsed).toBe(50);
      expect(result.fileCount).toBe(10);
    });

    it('should throw error when user not found', async () => {
      mockDatabase.user.findUnique.mockResolvedValue(null);
      mockDatabase.file.aggregate.mockResolvedValue({
        _sum: { size: 0 },
        _count: 0,
      });

      await expect(service.getUserStorageStats('nonexistent')).rejects.toThrow(
        'User not found',
      );
    });

    it('should handle zero quota gracefully', async () => {
      const user = UserFactory.build({
        id: userId,
        storageQuotaBytes: BigInt(0),
        storageUsedBytes: BigInt(0),
      });

      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.file.aggregate.mockResolvedValue({
        _sum: { size: 0 },
        _count: 0,
      });

      const result = await service.getUserStorageStats(userId);

      expect(result.percentUsed).toBe(0);
    });
  });

  describe('canUploadFile', () => {
    const userId = 'user-123';

    const mockInstanceSettings = {
      defaultStorageQuotaBytes: BigInt(53687091200),
      maxFileSizeBytes: BigInt(524288000), // 500MB
    };

    it('should allow upload within quota', async () => {
      const user = {
        storageQuotaBytes: BigInt(1000000),
        storageUsedBytes: BigInt(100000),
      };

      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.instanceSettings.findFirst.mockResolvedValue(
        mockInstanceSettings,
      );

      const result = await service.canUploadFile(userId, 50000);

      expect(result.canUpload).toBe(true);
      expect(result.remainingBytes).toBe(900000);
    });

    it('should deny upload exceeding max file size', async () => {
      const user = {
        storageQuotaBytes: BigInt(10000000000),
        storageUsedBytes: BigInt(0),
      };

      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.instanceSettings.findFirst.mockResolvedValue(
        mockInstanceSettings,
      );

      const result = await service.canUploadFile(userId, 600000000); // 600MB

      expect(result.canUpload).toBe(false);
      expect(result.message).toContain('exceeds maximum size');
    });

    it('should deny upload exceeding quota', async () => {
      const user = {
        storageQuotaBytes: BigInt(1000000),
        storageUsedBytes: BigInt(900000),
      };

      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.instanceSettings.findFirst.mockResolvedValue(
        mockInstanceSettings,
      );

      const result = await service.canUploadFile(userId, 200000);

      expect(result.canUpload).toBe(false);
      expect(result.message).toContain('exceed storage quota');
    });

    it('should handle user not found', async () => {
      mockDatabase.user.findUnique.mockResolvedValue(null);
      mockDatabase.instanceSettings.findFirst.mockResolvedValue(
        mockInstanceSettings,
      );

      const result = await service.canUploadFile(userId, 1000);

      expect(result.canUpload).toBe(false);
      expect(result.message).toBe('User not found');
    });

    it('should create default settings when none exist', async () => {
      const user = {
        storageQuotaBytes: BigInt(1000000),
        storageUsedBytes: BigInt(0),
      };

      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.instanceSettings.findFirst.mockResolvedValue(null);
      mockDatabase.instanceSettings.create.mockResolvedValue({
        defaultStorageQuotaBytes: BigInt(53687091200),
        maxFileSizeBytes: BigInt(524288000),
      });

      const result = await service.canUploadFile(userId, 1000);

      expect(result.canUpload).toBe(true);
      expect(mockDatabase.instanceSettings.create).toHaveBeenCalled();
    });
  });

  describe('incrementUserStorage', () => {
    it('should increment storage by given bytes', async () => {
      mockDatabase.user.update.mockResolvedValue({});

      await service.incrementUserStorage('user-123', 5000);

      expect(mockDatabase.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          storageUsedBytes: { increment: 5000 },
        },
      });
    });
  });

  describe('reserveStorage', () => {
    it('adds the bytes in one conditional update and reports success', async () => {
      mockDatabase.$executeRaw.mockResolvedValue(1);

      await expect(service.reserveStorage('user-123', 5000)).resolves.toBe(
        true,
      );

      expect(mockDatabase.$executeRaw).toHaveBeenCalledTimes(1);
      const [sql, ...values] = mockDatabase.$executeRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      const text = sql.join('?');
      expect(text).toContain('"storageUsedBytes" = "storageUsedBytes" + ?');
      expect(text).toContain('"storageUsedBytes" + ? <= "storageQuotaBytes"');
      expect(values).toEqual([BigInt(5000), 'user-123', BigInt(5000)]);
      // No read-then-write: the check and the add are the same statement
      expect(mockDatabase.user.findUnique).not.toHaveBeenCalled();
      expect(mockDatabase.user.update).not.toHaveBeenCalled();
    });

    it('reports failure when the bytes do not fit (no row updated)', async () => {
      mockDatabase.$executeRaw.mockResolvedValue(0);

      await expect(service.reserveStorage('user-123', 5000)).resolves.toBe(
        false,
      );
    });
  });

  describe('decrementUserStorage', () => {
    it('subtracts in one statement, never below zero', async () => {
      mockDatabase.$executeRaw.mockResolvedValue(1);

      await service.decrementUserStorage('user-123', 5000);

      const [sql, ...values] = mockDatabase.$executeRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(sql.join('?')).toContain(
        '"storageUsedBytes" = GREATEST(0, "storageUsedBytes" - ?)',
      );
      expect(values).toEqual([BigInt(5000), 'user-123']);
      expect(mockDatabase.user.update).not.toHaveBeenCalled();
    });
  });

  describe('recalculateUserStorage', () => {
    const userId = 'user-123';

    it('should recalculate from actual file sizes', async () => {
      mockDatabase.file.aggregate.mockResolvedValue({
        _sum: { size: 42000 },
        _count: 5,
      });
      mockDatabase.user.update.mockResolvedValue({});

      // getUserStorageStats will be called after recalculation
      const user = UserFactory.build({
        id: userId,
        storageQuotaBytes: BigInt(1000000),
        storageUsedBytes: BigInt(42000),
      });
      mockDatabase.user.findUnique.mockResolvedValue(user);

      await service.recalculateUserStorage(userId);

      expect(mockDatabase.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { storageUsedBytes: 42000 },
      });
    });

    it('should handle zero files', async () => {
      mockDatabase.file.aggregate.mockResolvedValue({
        _sum: { size: null },
        _count: 0,
      });
      mockDatabase.user.update.mockResolvedValue({});

      const user = UserFactory.build({
        id: userId,
        storageQuotaBytes: BigInt(1000000),
        storageUsedBytes: BigInt(0),
      });
      mockDatabase.user.findUnique.mockResolvedValue(user);

      await service.recalculateUserStorage(userId);

      expect(mockDatabase.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { storageUsedBytes: 0 },
      });
    });
  });

  describe('getInstanceStorageStats', () => {
    it('should aggregate instance-wide stats', async () => {
      const mockSettings = {
        defaultStorageQuotaBytes: BigInt(53687091200),
        maxFileSizeBytes: BigInt(524288000),
      };

      mockDatabase.instanceSettings.findFirst.mockResolvedValue(mockSettings);
      mockDatabase.file.aggregate.mockResolvedValue({
        _sum: { size: 1000000 },
        _count: 50,
      });
      mockDatabase.user.count.mockResolvedValue(10);
      mockDatabase.file.groupBy.mockResolvedValue([
        { resourceType: 'MESSAGE', _sum: { size: 800000 }, _count: 40 },
        { resourceType: 'AVATAR', _sum: { size: 200000 }, _count: 10 },
      ]);
      mockDatabase.user.findMany.mockResolvedValue([
        {
          storageQuotaBytes: BigInt(1000000),
          storageUsedBytes: BigInt(100000),
        },
        {
          storageQuotaBytes: BigInt(1000000),
          storageUsedBytes: BigInt(500000),
        },
      ]);

      const result = await service.getInstanceStorageStats();

      expect(result.totalStorageUsedBytes).toBe(1000000);
      expect(result.totalFileCount).toBe(50);
      expect(result.totalUserCount).toBe(10);
      expect(result.averageStoragePerUserBytes).toBe(100000);
      expect(result.storageByType).toHaveLength(2);
    });
  });

  describe('recalculateAllUsersStorage', () => {
    it('should iterate over all users', async () => {
      mockDatabase.user.findMany.mockResolvedValue([
        { id: 'user-1' },
        { id: 'user-2' },
      ]);
      mockDatabase.file.aggregate.mockResolvedValue({
        _sum: { size: 0 },
        _count: 0,
      });
      mockDatabase.user.update.mockResolvedValue({});

      const user = UserFactory.build({
        storageQuotaBytes: BigInt(1000000),
        storageUsedBytes: BigInt(0),
      });
      mockDatabase.user.findUnique.mockResolvedValue(user);

      await service.recalculateAllUsersStorage();

      // file.aggregate called twice per user (once in recalculateUserStorage, once in getUserStorageStats)
      expect(mockDatabase.file.aggregate).toHaveBeenCalledTimes(4);
    });

    it('should continue on individual user errors', async () => {
      mockDatabase.user.findMany.mockResolvedValue([
        { id: 'user-1' },
        { id: 'user-2' },
      ]);

      // First user fails, second succeeds
      mockDatabase.file.aggregate
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ _sum: { size: 0 }, _count: 0 });
      mockDatabase.user.update.mockResolvedValue({});

      const user = UserFactory.build({
        storageQuotaBytes: BigInt(1000000),
        storageUsedBytes: BigInt(0),
      });
      mockDatabase.user.findUnique.mockResolvedValue(user);

      // Should not throw despite first user failing
      await expect(service.recalculateAllUsersStorage()).resolves.not.toThrow();
    });
  });

  describe('updateStorageSettings', () => {
    it('should update existing settings', async () => {
      const existing = { id: 'settings-1' };
      mockDatabase.instanceSettings.findFirst.mockResolvedValue(existing);
      mockDatabase.instanceSettings.update.mockResolvedValue({});

      await service.updateStorageSettings(1000000, 500000);

      expect(mockDatabase.instanceSettings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: {
          defaultStorageQuotaBytes: 1000000,
          maxFileSizeBytes: 500000,
        },
      });
    });

    it('should create settings when none exist', async () => {
      mockDatabase.instanceSettings.findFirst.mockResolvedValue(null);
      mockDatabase.instanceSettings.create.mockResolvedValue({});

      await service.updateStorageSettings(1000000);

      expect(mockDatabase.instanceSettings.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Semaphore Chat',
          defaultStorageQuotaBytes: 1000000,
        }),
      });
    });
  });

  describe('getUsersStorageList', () => {
    it('should return paginated user list sorted by usage', async () => {
      mockDatabase.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          username: 'alice',
          storageQuotaBytes: BigInt(1000000),
          storageUsedBytes: BigInt(900000),
          _count: { File: 10 },
        },
        {
          id: 'u2',
          username: 'bob',
          storageQuotaBytes: BigInt(1000000),
          storageUsedBytes: BigInt(100000),
          _count: { File: 2 },
        },
      ]);

      const result = await service.getUsersStorageList({
        skip: 0,
        take: 50,
      });

      expect(result.users).toHaveLength(2);
      // Sorted by percentUsed descending
      expect(result.users[0].username).toBe('alice');
      expect(result.users[1].username).toBe('bob');
    });

    it('should filter by minimum percentage', async () => {
      mockDatabase.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          username: 'alice',
          storageQuotaBytes: BigInt(1000000),
          storageUsedBytes: BigInt(900000),
          _count: { File: 10 },
        },
        {
          id: 'u2',
          username: 'bob',
          storageQuotaBytes: BigInt(1000000),
          storageUsedBytes: BigInt(100000),
          _count: { File: 2 },
        },
      ]);

      const result = await service.getUsersStorageList({
        minPercentUsed: 50,
      });

      expect(result.users).toHaveLength(1);
      expect(result.users[0].username).toBe('alice');
    });
  });
});
