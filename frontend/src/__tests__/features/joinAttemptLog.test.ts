import { describe, it, expect, beforeEach } from 'vitest';
import {
  JOIN_ATTEMPT_LOG_SIZE,
  getJoinAttempts,
  recordJoinAttempt,
  resetJoinAttempts,
  setJoinAttemptIce,
  type JoinAttempt,
} from '../../features/voice/joinAttemptLog';

const attempt = (n: number, patch: Partial<JoinAttempt> = {}): JoinAttempt => ({
  startedAt: n,
  target: { type: 'channel', channelId: `ch-${n}` },
  quiet: false,
  durationMs: 10,
  outcome: 'success',
  ...patch,
});

describe('joinAttemptLog', () => {
  beforeEach(() => resetJoinAttempts());

  it('keeps attempts oldest first', () => {
    recordJoinAttempt(attempt(1));
    recordJoinAttempt(attempt(2, { outcome: 'failed' }));
    expect(getJoinAttempts().map((a) => a.startedAt)).toEqual([1, 2]);
  });

  it('keeps only the most recent JOIN_ATTEMPT_LOG_SIZE attempts', () => {
    for (let i = 1; i <= JOIN_ATTEMPT_LOG_SIZE + 5; i++) recordJoinAttempt(attempt(i));
    const kept = getJoinAttempts();
    expect(kept).toHaveLength(JOIN_ATTEMPT_LOG_SIZE);
    expect(kept[0].startedAt).toBe(6);
    expect(kept[kept.length - 1].startedAt).toBe(JOIN_ATTEMPT_LOG_SIZE + 5);
  });

  it('attaches the ICE summary to the right attempt later', () => {
    const first = recordJoinAttempt(attempt(1));
    recordJoinAttempt(attempt(2));
    const ice = { publisher: null, subscriber: null, turnOffered: true };
    setJoinAttemptIce(first, ice);
    expect(getJoinAttempts()[0].ice).toBe(ice);
    expect(getJoinAttempts()[1].ice).toBeUndefined();
  });

  it('setting ICE for an attempt that has rolled out is a no-op', () => {
    const old = recordJoinAttempt(attempt(0));
    for (let i = 1; i <= JOIN_ATTEMPT_LOG_SIZE; i++) recordJoinAttempt(attempt(i));
    setJoinAttemptIce(old, null);
    expect(getJoinAttempts().every((a) => a.ice === undefined)).toBe(true);
  });
});
