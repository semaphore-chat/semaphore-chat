import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { DatabaseService } from '@/database/database.service';
import {
  TIMEOUT_EXPIRY_QUEUE,
  resolveJobWorkerConcurrency,
} from '@/jobs/jobs.constants';
import { TimeoutExpiryJobData } from '@/jobs/jobs.types';
import { RoomEvents } from '@/rooms/room-subscription.events';

const CONCURRENCY = resolveJobWorkerConcurrency();

/**
 * Consumes the `timeout-expiry` queue: delayed jobs ModerationService
 * schedules for a timeout's `expiresAt`. A user who stays connected to a
 * voice call through their timeout would otherwise stay listen-only until
 * they rejoin.
 *
 * Works from current state, so it's idempotent:
 * - timeout still active (extended or re-applied): no-op; the newer
 *   timeout's own job handles it;
 * - otherwise (expired, or its row already gone): emit
 *   MODERATION_TIMEOUT_CHANGED, whose handler recomputes the user's grants
 *   in every voice room of the community they're in. A missing row can be
 *   a timeout that expired and was cleaned up lazily, so it isn't skipped;
 *   for one lifted early (whose job removeTimeout cancels anyway) the
 *   recompute yields the grant already in place.
 */
@Processor(TIMEOUT_EXPIRY_QUEUE, { concurrency: CONCURRENCY })
export class TimeoutExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(TimeoutExpiryProcessor.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<TimeoutExpiryJobData>): Promise<void> {
    const { userId, communityId } = job.data;

    const timeout = await this.databaseService.communityTimeout.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { expiresAt: true },
    });
    if (timeout && timeout.expiresAt > new Date()) {
      this.logger.debug(
        `Timeout of ${userId} in ${communityId} still active until ${timeout.expiresAt.toISOString()} (job ${job.id}): skipping`,
      );
      return;
    }

    await this.eventEmitter.emitAsync(RoomEvents.MODERATION_TIMEOUT_CHANGED, {
      userId,
      communityId,
    });
    this.logger.log(
      `Timeout of ${userId} in community ${communityId} ended: voice grants recomputed`,
    );
  }
}
