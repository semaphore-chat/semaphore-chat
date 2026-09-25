import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { DatabaseService } from '@/database/database.service';

const CHECK_TIMEOUT_MS = 3000;

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await Promise.race([
        this.databaseService.$executeRaw`SELECT 1`,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Database health check timed out')),
            CHECK_TIMEOUT_MS,
          ),
        ),
      ]);
      return indicator.up();
    } catch {
      return indicator.down();
    }
  }
}
