import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceFailureKind } from '../../contexts/VoiceContext';
import type { JoinAttempt } from '../../features/voice/joinAttemptLog';

const mockReport = vi.fn().mockResolvedValue({});
vi.mock('../../api-client/sdk.gen', () => ({
  voiceDiagnosticsControllerReportJoinFailure: (...args: unknown[]) => mockReport(...args),
}));

import {
  JOIN_FAILURE_REPORT_INTERVAL_MS,
  reportJoinFailure,
  resetJoinFailureReporting,
} from '../../features/voice/joinFailureReport';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';

const failed = (patch: Partial<JoinAttempt> = {}): JoinAttempt => ({
  startedAt: 1,
  target: { type: 'channel', channelId: 'chan-1' },
  quiet: false,
  durationMs: 15234.6,
  outcome: 'failed',
  errorKind: VoiceFailureKind.MediaUnreachable,
  errorMessage: 'could not establish pc connection',
  ...patch,
});

describe('reportJoinFailure', () => {
  beforeEach(() => {
    mockReport.mockClear();
    resetJoinFailureReporting();
    setElectronAPIOverride(null);
  });

  it('posts the failure with class, message, duration, platform and channel', () => {
    reportJoinFailure(failed(), 1_000_000);

    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls[0][0].body).toMatchObject({
      errorClass: 'media_unreachable',
      message: 'could not establish pc connection',
      durationMs: 15235,
      platform: 'web',
      channelId: 'chan-1',
      isDm: false,
      appVersion: expect.any(String),
    });
    expect(mockReport.mock.calls[0][0].body.candidateTypes).toBeUndefined();
  });

  it('sends candidate types when the ICE path is known', () => {
    reportJoinFailure(
      failed({
        ice: {
          publisher: { selected: { localType: 'relay' }, localCandidateTypes: ['host', 'relay'] },
          subscriber: null,
          turnOffered: true,
        },
      }),
      1_000_000,
    );
    expect(mockReport.mock.calls[0][0].body.candidateTypes.sort()).toEqual(['host', 'relay']);
  });

  it('never sends a DM group id', () => {
    reportJoinFailure(failed({ target: { type: 'dm', dmGroupId: 'dm-secret' } }), 1_000_000);
    const body = mockReport.mock.calls[0][0].body;
    expect(body.isDm).toBe(true);
    expect(body.channelId).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('dm-secret');
  });

  it('truncates long messages', () => {
    reportJoinFailure(failed({ errorMessage: 'x'.repeat(5000) }), 1_000_000);
    expect(mockReport.mock.calls[0][0].body.message).toHaveLength(500);
  });

  it('sends at most one report a minute (a rejoin backoff storm sends one)', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 11; i++) reportJoinFailure(failed({ quiet: true }), t0 + i * 1000);
    expect(mockReport).toHaveBeenCalledTimes(1);

    reportJoinFailure(failed(), t0 + JOIN_FAILURE_REPORT_INTERVAL_MS - 1);
    expect(mockReport).toHaveBeenCalledTimes(1);
    reportJoinFailure(failed(), t0 + JOIN_FAILURE_REPORT_INTERVAL_MS);
    expect(mockReport).toHaveBeenCalledTimes(2);
  });

  it('does not report successes or cancelled joins', () => {
    reportJoinFailure(failed({ outcome: 'success' }), 1_000_000);
    reportJoinFailure(failed({ outcome: 'cancelled' }), 1_000_000);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('a failing request never throws', async () => {
    mockReport.mockRejectedValueOnce(new Error('offline'));
    expect(() => reportJoinFailure(failed(), 1_000_000)).not.toThrow();
    await Promise.resolve();
  });

  it('desktop: reports the platform and writes every failure to the app log', () => {
    const logVoiceEvent = vi.fn();
    setElectronAPIOverride(createFakeElectronAPI({ logVoiceEvent }));

    reportJoinFailure(failed(), 1_000_000);
    reportJoinFailure(failed(), 1_000_500); // rate-limited for the server, not the log

    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls[0][0].body.platform).toBe('electron');
    expect(logVoiceEvent).toHaveBeenCalledTimes(2);
    expect(logVoiceEvent).toHaveBeenCalledWith({
      level: 'warn',
      event: 'join-failed',
      data: expect.objectContaining({ errorKind: 'media_unreachable', target: 'channel' }),
    });
  });
});
