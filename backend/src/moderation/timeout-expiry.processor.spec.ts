import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import type { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TimeoutExpiryProcessor } from './timeout-expiry.processor';
import { DatabaseService } from '@/database/database.service';
import { createMockDatabase } from '@/test-utils';
import { TimeoutExpiryJobData } from '@/jobs/jobs.types';
import { RoomEvents } from '@/rooms/room-subscription.events';

describe('TimeoutExpiryProcessor', () => {
  let processor: TimeoutExpiryProcessor;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let eventEmitter: Mocked<EventEmitter2>;

  const moderatorId = 'moderator-1';

  const data: TimeoutExpiryJobData = {
    userId: 'user-1',
    communityId: 'community-1',
    expiresAt: '2026-10-05T12:00:00.000Z',
    moderatorId,
  };
  const job = { id: 'job-1', data } as unknown as Job<TimeoutExpiryJobData>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();
    const { unit, unitRef } = await TestBed.solitary(TimeoutExpiryProcessor)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();
    processor = unit;
    eventEmitter = unitRef.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('restores voice and tells clients the timeout is gone when it expired', async () => {
    mockDatabase.communityTimeout.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1_000),
      moderatorId,
    });

    await processor.process(job);

    expect(mockDatabase.communityTimeout.findUnique).toHaveBeenCalledWith({
      where: {
        communityId_userId: { communityId: 'community-1', userId: 'user-1' },
      },
      select: { expiresAt: true, moderatorId: true },
    });
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      RoomEvents.MODERATION_TIMEOUT_CHANGED,
      { userId: 'user-1', communityId: 'community-1' },
    );
    // The same event an early lift sends, marked expired.
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      RoomEvents.MODERATION_TIMEOUT_EXPIRED,
      { userId: 'user-1', communityId: 'community-1', moderatorId },
    );
  });

  it("uses the job's moderator when the expired row was already cleaned up", async () => {
    mockDatabase.communityTimeout.findUnique.mockResolvedValue(null);

    await processor.process(job);

    // Recomputing is idempotent: the handler sets the grant current state
    // allows, which for a lifted timeout is the grant already in place.
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      RoomEvents.MODERATION_TIMEOUT_CHANGED,
      { userId: 'user-1', communityId: 'community-1' },
    );
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      RoomEvents.MODERATION_TIMEOUT_EXPIRED,
      { userId: 'user-1', communityId: 'community-1', moderatorId },
    );
  });

  it('sends no expired event for a job queued before the moderator was carried', async () => {
    const legacyJob = {
      id: 'job-0',
      data: { ...data, moderatorId: undefined },
    } as unknown as Job<TimeoutExpiryJobData>;
    mockDatabase.communityTimeout.findUnique.mockResolvedValue(null);

    await processor.process(legacyJob);

    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      RoomEvents.MODERATION_TIMEOUT_CHANGED,
      { userId: 'user-1', communityId: 'community-1' },
    );
    expect(eventEmitter.emitAsync).not.toHaveBeenCalledWith(
      RoomEvents.MODERATION_TIMEOUT_EXPIRED,
      expect.anything(),
    );
  });

  it('is a no-op when the timeout was extended (still active)', async () => {
    mockDatabase.communityTimeout.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      moderatorId,
    });

    await processor.process(job);

    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });
});
