import { TestBed } from '@suites/unit';
import { HealthService } from './health.service';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import { DatabaseService } from '@/database/database.service';
import { createMockRedis } from '@/test-utils';

describe('HealthService', () => {
  let service: HealthService;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockDatabase: { $queryRawUnsafe: jest.Mock };

  beforeEach(async () => {
    mockRedis = createMockRedis();
    mockDatabase = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };

    const { unit } = await TestBed.solitary(HealthService)
      .mock(REDIS_CLIENT)
      .final(mockRedis)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should load instance name from Redis on initialization', async () => {
      mockRedis.get.mockResolvedValue('My Custom Instance');

      await service.onModuleInit();

      expect(mockRedis.get).toHaveBeenCalledWith('instance:name');
      expect(service.getInstanceName()).toBe('My Custom Instance');
    });

    it('should use default name when Redis returns null', async () => {
      mockRedis.get.mockResolvedValue(null);

      await service.onModuleInit();

      expect(mockRedis.get).toHaveBeenCalledWith('instance:name');
      expect(service.getInstanceName()).toBe('Semaphore Chat Instance');
    });

    it('should use default name when Redis throws error', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));

      await service.onModuleInit();

      expect(service.getInstanceName()).toBe('Semaphore Chat Instance');
    });

    it('should log when instance name is loaded successfully', async () => {
      mockRedis.get.mockResolvedValue('Prod Instance');
      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.onModuleInit();

      expect(loggerSpy).toHaveBeenCalledWith(
        'Loaded instance name from Redis: Prod Instance',
      );
    });

    it('should log when no instance name found in Redis', async () => {
      mockRedis.get.mockResolvedValue(null);
      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.onModuleInit();

      expect(loggerSpy).toHaveBeenCalledWith(
        'No instance name found in Redis, using default: Semaphore Chat Instance',
      );
    });

    it('should log error when Redis fails', async () => {
      const error = new Error('Connection timeout');
      mockRedis.get.mockRejectedValue(error);
      const loggerSpy = jest.spyOn(service['logger'], 'error');

      await service.onModuleInit();

      expect(loggerSpy).toHaveBeenCalledWith(
        'Failed to load instance name from Redis',
        error,
      );
    });
  });

  describe('getInstanceName', () => {
    it('should return cached instance name', () => {
      const name = service.getInstanceName();

      expect(name).toBe('Semaphore Chat Instance');
      expect(mockRedis.get).not.toHaveBeenCalled(); // Should not call Redis
    });

    it('should return updated name after onModuleInit', async () => {
      mockRedis.get.mockResolvedValue('Updated Name');
      await service.onModuleInit();

      const name = service.getInstanceName();

      expect(name).toBe('Updated Name');
    });
  });

  describe('getHealthMetadata', () => {
    it('should return health metadata with correct structure', () => {
      const metadata = service.getHealthMetadata();

      expect(metadata).toHaveProperty('status');
      expect(metadata).toHaveProperty('instanceName');
      expect(metadata).toHaveProperty('version');
      expect(metadata).toHaveProperty('timestamp');
    });

    it('should return status as ok', () => {
      const metadata = service.getHealthMetadata();

      expect(metadata.status).toBe('ok');
    });

    it('should return default instance name', () => {
      const metadata = service.getHealthMetadata();

      expect(metadata.instanceName).toBe('Semaphore Chat Instance');
    });

    it('should return updated instance name after initialization', async () => {
      mockRedis.get.mockResolvedValue('Custom Instance');
      await service.onModuleInit();

      const metadata = service.getHealthMetadata();

      expect(metadata.instanceName).toBe('Custom Instance');
    });

    it('should return timestamp as ISO string', () => {
      const metadata = service.getHealthMetadata();

      expect(metadata.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it('should return current timestamp on each call', () => {
      const metadata1 = service.getHealthMetadata();
      const metadata2 = service.getHealthMetadata();

      // Timestamps should be very close but may differ slightly
      expect(new Date(metadata1.timestamp).getTime()).toBeLessThanOrEqual(
        new Date(metadata2.timestamp).getTime(),
      );
    });

    it('should not call Redis for metadata', () => {
      service.getHealthMetadata();

      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });

  describe('checkHealth', () => {
    it('should return ok when both Redis and database are healthy', async () => {
      const result = await service.checkHealth();

      expect(result.status).toBe('ok');
      expect(result.checks.redis.status).toBe('up');
      expect(result.checks.database.status).toBe('up');
      expect(result).toHaveProperty('instanceName');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('timestamp');
    });

    it('should return degraded when Redis is down', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Connection refused'));

      const result = await service.checkHealth();

      expect(result.status).toBe('degraded');
      expect(result.checks.redis.status).toBe('down');
      expect(result.checks.redis.error).toBe('Connection refused');
      expect(result.checks.database.status).toBe('up');
    });

    it('should return degraded when database is down', async () => {
      mockDatabase.$queryRawUnsafe.mockRejectedValue(
        new Error('Connection terminated'),
      );

      const result = await service.checkHealth();

      expect(result.status).toBe('degraded');
      expect(result.checks.redis.status).toBe('up');
      expect(result.checks.database.status).toBe('down');
      expect(result.checks.database.error).toBe('Connection terminated');
    });

    it('should return degraded when both are down', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Redis offline'));
      mockDatabase.$queryRawUnsafe.mockRejectedValue(new Error('DB offline'));

      const result = await service.checkHealth();

      expect(result.status).toBe('degraded');
      expect(result.checks.redis.status).toBe('down');
      expect(result.checks.redis.error).toBe('Redis offline');
      expect(result.checks.database.status).toBe('down');
      expect(result.checks.database.error).toBe('DB offline');
    });

    it('should not include error field when checks pass', async () => {
      const result = await service.checkHealth();

      expect(result.checks.redis).not.toHaveProperty('error');
      expect(result.checks.database).not.toHaveProperty('error');
    });

    it('should log errors for failed checks', async () => {
      const loggerSpy = jest.spyOn(service['logger'], 'error');
      mockRedis.ping.mockRejectedValue(new Error('Redis offline'));

      await service.checkHealth();

      expect(loggerSpy).toHaveBeenCalledWith(
        'Redis health check failed',
        expect.any(Error),
      );
    });

    it('should call redis.ping and database.$queryRawUnsafe', async () => {
      await service.checkHealth();

      expect(mockRedis.ping).toHaveBeenCalled();
      expect(mockDatabase.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
    });
  });
});
