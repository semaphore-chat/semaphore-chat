import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { DatabaseHealthIndicator } from './database.health-indicator';
import { DatabaseService } from '@/database/database.service';
import { HealthIndicatorService } from '@nestjs/terminus';

describe('DatabaseHealthIndicator', () => {
  let indicator: DatabaseHealthIndicator;
  let databaseService: Mocked<DatabaseService>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(DatabaseHealthIndicator)
      .mock(HealthIndicatorService)
      .final(new HealthIndicatorService())
      .compile();
    indicator = unit;
    databaseService = unitRef.get(DatabaseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return up when database is reachable', async () => {
    databaseService.$executeRaw.mockResolvedValue(1);

    const result = await indicator.isHealthy('database');

    expect(result).toEqual({ database: { status: 'up' } });
  });

  it('should return down when database is unreachable', async () => {
    databaseService.$executeRaw.mockRejectedValue(
      new Error('Connection refused'),
    );

    const result = await indicator.isHealthy('database');

    expect(result).toEqual({ database: { status: 'down' } });
  });

  it('should return down when query times out', async () => {
    jest.useFakeTimers();

    databaseService.$executeRaw.mockReturnValue(new Promise(() => {}) as never);

    const healthPromise = indicator.isHealthy('database');
    jest.advanceTimersByTime(3000);

    await expect(healthPromise).resolves.toEqual({
      database: { status: 'down' },
    });

    jest.useRealTimers();
  });
});
