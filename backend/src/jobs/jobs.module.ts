import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  MESSAGE_FANOUT_QUEUE,
  LINK_PREVIEWS_QUEUE,
  TIMEOUT_EXPIRY_QUEUE,
} from './jobs.constants';

/**
 * Central BullMQ registration for Semaphore Chat's background job queues.
 *
 * Global, and imported exactly once from AppModule (mirrors the
 * `ConfigModule.forRoot({ isGlobal: true })` pattern already used there) —
 * every feature module can inject a queue with `@InjectQueue(...)` or host a
 * `@Processor(...)` consumer without importing this module directly.
 *
 * BullMQ needs its OWN ioredis-compatible connection with
 * `maxRetriesPerRequest: null` (required for the blocking commands the
 * queue/worker internals issue) — this is intentionally a SEPARATE
 * connection from the shared `REDIS_CLIENT` in RedisModule (which is tuned
 * for request-path caching/pub-sub and does not set that option). All job
 * keys live under the `semaphore:jobs` prefix so they're easy to spot in
 * `redis-cli --scan`/RDB dumps alongside the rest of the app's Redis keys.
 *
 * Processors currently run in-process on the API container (registered as
 * providers in their owning feature modules — see
 * NotificationsFanoutProcessor in notifications.module.ts and
 * LinkPreviewsProcessor in link-previews.module.ts). To split job
 * processing into a dedicated worker deployment later: boot a separate Nest
 * application (`NestFactory.createApplicationContext`) that imports this
 * JobsModule plus the two processor providers — @nestjs/bullmq workers run
 * identically in any process that has this module and a processor provider,
 * no HTTP server required.
 *
 * ROLLING-DEPLOY PAYLOAD CONVENTION: because processors run in-process on
 * every API replica, a rolling deploy has old and new code enqueuing/
 * consuming the SAME queues simultaneously — an old replica's worker can
 * pick up a job enqueued by a new replica, and vice versa, until the
 * rollout finishes. Job payload shapes (`MessageFanoutJobData`,
 * `LinkPreviewJobData` in jobs.types.ts) must therefore stay
 * additive/backward-compatible for at least one release: only add optional
 * fields, never remove/rename/repurpose an existing field, and give new
 * processor logic a fallback for payloads that predate it. If a genuinely
 * breaking payload change is ever unavoidable, add a `version` field to the
 * payload (default/absent = the current shape) so processors can branch on
 * it instead of assuming every job in the queue matches the newest shape.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') || 'localhost',
          port: parseInt(config.get<string>('REDIS_PORT') || '6379', 10),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          db: parseInt(config.get<string>('REDIS_DB') || '0', 10),
          // Required by BullMQ: the blocking commands its internals use
          // (BZPOPMIN etc.) are incompatible with ioredis's default retry
          // behavior for commands that time out mid-flight.
          maxRetriesPerRequest: null,
        },
        prefix: 'semaphore:jobs',
      }),
    }),
    BullModule.registerQueue(
      {
        name: MESSAGE_FANOUT_QUEUE,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86400 },
        },
      },
      {
        name: LINK_PREVIEWS_QUEUE,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86400 },
        },
      },
      {
        // Delayed: one job per timeout, firing at its expiry (moderation)
        name: TIMEOUT_EXPIRY_QUEUE,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: { age: 86400 },
        },
      },
    ),
  ],
  exports: [BullModule],
})
export class JobsModule {}
