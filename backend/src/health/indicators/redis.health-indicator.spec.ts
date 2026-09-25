import { TestBed } from '@suites/unit';
import { RedisHealthIndicator } from './redis.health-indicator';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import { createMockRedis } from '@/test-utils';
import { HealthIndicatorService } from '@nestjs/terminus';

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    mockRedis = createMockRedis();

    const { unit } = await TestBed.solitary(RedisHealthIndicator)
      .mock(REDIS_CLIENT)
      .final(mockRedis)
      .mock(HealthIndicatorService)
      .final(new HealthIndicatorService())
      .compile();

    indicator = unit;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return up when Redis is reachable', async () => {
    const result = await indicator.isHealthy('redis');

    expect(result).toEqual({ redis: { status: 'up' } });
    expect(mockRedis.ping).toHaveBeenCalled();
  });

  it('should return down when Redis is unreachable', async () => {
    mockRedis.ping.mockRejectedValue(new Error('Connection refused'));

    const result = await indicator.isHealthy('redis');

    expect(result).toEqual({ redis: { status: 'down' } });
  });

  it('should return down when ping times out', async () => {
    jest.useFakeTimers();

    mockRedis.ping.mockReturnValue(new Promise(() => {}));

    const healthPromise = indicator.isHealthy('redis');
    jest.advanceTimersByTime(3000);

    await expect(healthPromise).resolves.toEqual({
      redis: { status: 'down' },
    });

    jest.useRealTimers();
  });
});
