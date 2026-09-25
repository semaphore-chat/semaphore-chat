import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import Redis from 'ioredis';

const CHECK_TIMEOUT_MS = 3000;

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await Promise.race([
        this.redis.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Redis health check timed out')),
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
