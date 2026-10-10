import { ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import {
  JOIN_FAILURE_REPORT_LIMIT,
  JOIN_FAILURE_REPORT_WINDOW_MS,
  JoinFailureThrottleGuard,
} from './join-failure-throttle.guard';

function contextFor(user?: { id: string }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('JoinFailureThrottleGuard', () => {
  let increment: jest.Mock;
  let guard: JoinFailureThrottleGuard;

  beforeEach(() => {
    increment = jest.fn();
    guard = new JoinFailureThrottleGuard({ increment });
  });

  const hits = (totalHits: number) =>
    increment.mockResolvedValue({
      totalHits,
      timeToExpire: 1,
      isBlocked: false,
      timeToBlockExpire: 0,
    });

  it('counts per user, in a one-minute window', async () => {
    hits(1);
    await expect(guard.canActivate(contextFor({ id: 'user-1' }))).resolves.toBe(
      true,
    );
    expect(increment).toHaveBeenCalledWith(
      'voice-join-failure:user-1',
      JOIN_FAILURE_REPORT_WINDOW_MS,
      JOIN_FAILURE_REPORT_LIMIT,
      0,
      'voice-join-failure',
    );
  });

  it('allows up to the limit', async () => {
    hits(JOIN_FAILURE_REPORT_LIMIT);
    await expect(guard.canActivate(contextFor({ id: 'user-1' }))).resolves.toBe(
      true,
    );
  });

  it('rejects past the limit with 429', async () => {
    hits(JOIN_FAILURE_REPORT_LIMIT + 1);
    await expect(
      guard.canActivate(contextFor({ id: 'user-1' })),
    ).rejects.toBeInstanceOf(ThrottlerException);
  });

  it('keeps separate buckets per user', async () => {
    hits(1);
    await guard.canActivate(contextFor({ id: 'user-1' }));
    await guard.canActivate(contextFor({ id: 'user-2' }));
    expect(increment.mock.calls.map((c) => c[0])).toEqual([
      'voice-join-failure:user-1',
      'voice-join-failure:user-2',
    ]);
  });

  it('leaves unauthenticated requests to the auth guard', async () => {
    await expect(guard.canActivate(contextFor(undefined))).resolves.toBe(true);
    expect(increment).not.toHaveBeenCalled();
  });
});
