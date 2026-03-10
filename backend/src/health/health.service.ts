import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import { DatabaseService } from '@/database/database.service';
import Redis from 'ioredis';
import { version } from '../../package.json';
import { HealthResponseDto } from './dto/health-response.dto';

const HEALTH_CHECK_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Health check timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err: Error) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function getErrorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  return 'Unknown error';
}

@Injectable()
export class HealthService implements OnModuleInit {
  private readonly logger = new Logger(HealthService.name);
  private instanceName: string = 'Semaphore Chat Instance'; // Default fallback
  private readonly INSTANCE_NAME_KEY = 'instance:name';

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly databaseService: DatabaseService,
  ) {}

  /**
   * Load instance name from Redis on module initialization
   * Cache in memory to avoid Redis load on every health check
   */
  async onModuleInit() {
    try {
      const name = await this.redis.get(this.INSTANCE_NAME_KEY);
      if (name) {
        this.instanceName = name;
        this.logger.log(`Loaded instance name from Redis: ${name}`);
      } else {
        this.logger.log(
          'No instance name found in Redis, using default: Semaphore Chat Instance',
        );
      }
    } catch (error) {
      this.logger.error('Failed to load instance name from Redis', error);
      // Continue with default name
    }
  }

  /**
   * Get the cached instance name
   * No Redis/DB calls - returns in-memory cached value
   */
  getInstanceName(): string {
    return this.instanceName;
  }

  /**
   * Get health check metadata
   * Returns instance information for validation and monitoring
   */
  getHealthMetadata(): {
    status: string;
    instanceName: string;
    version: string;
    timestamp: string;
  } {
    return {
      status: 'ok',
      instanceName: this.instanceName,
      version,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check health of all critical dependencies (Redis + Database).
   * Each check has a 3-second timeout so the total stays well within
   * the Kubernetes probe timeoutSeconds: 5.
   */
  async checkHealth(): Promise<HealthResponseDto> {
    const [redisResult, dbResult] = await Promise.allSettled([
      withTimeout(this.redis.ping(), HEALTH_CHECK_TIMEOUT_MS),
      withTimeout(
        this.databaseService.$queryRawUnsafe('SELECT 1'),
        HEALTH_CHECK_TIMEOUT_MS,
      ),
    ]);

    const redisUp = redisResult.status === 'fulfilled';
    const dbUp = dbResult.status === 'fulfilled';

    if (!redisUp) {
      this.logger.error('Redis health check failed', redisResult.reason);
    }
    if (!dbUp) {
      this.logger.error('Database health check failed', dbResult.reason);
    }

    const allUp = redisUp && dbUp;

    return {
      status: allUp ? 'ok' : 'degraded',
      instanceName: this.instanceName,
      version,
      timestamp: new Date().toISOString(),
      checks: {
        redis: {
          status: redisUp ? 'up' : 'down',
          ...(redisUp ? {} : { error: getErrorMessage(redisResult.reason) }),
        },
        database: {
          status: dbUp ? 'up' : 'down',
          ...(dbUp ? {} : { error: getErrorMessage(dbResult.reason) }),
        },
      },
    };
  }
}
