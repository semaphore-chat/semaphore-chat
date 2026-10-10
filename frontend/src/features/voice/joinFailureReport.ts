import { voiceDiagnosticsControllerReportJoinFailure } from '../../api-client/sdk.gen';
import { isElectron } from '../../utils/platform';
import { getElectronAPI } from '../../utils/electronBridge';
import { logger } from '../../utils/logger';
import { VoiceFailureKind } from '../../contexts/VoiceContext';
import type { JoinAttempt } from './joinAttemptLog';
import { candidateTypesOf } from './iceSummary';

/**
 * Reports failed voice joins: to the server log (POST
 * /voice/diagnostics/join-failure, at most once a minute, so a rejoin backoff
 * can't flood it) and to the desktop app's log file (every failure).
 */

export const JOIN_FAILURE_REPORT_INTERVAL_MS = 60_000;
const MESSAGE_MAX = 500;

let lastReportedAt = Number.NEGATIVE_INFINITY;

function appVersion(): string {
  return (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev';
}

function osName(): string | undefined {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return (nav.userAgentData?.platform || nav.platform || undefined)?.slice(0, 64);
}

export function reportJoinFailure(attempt: JoinAttempt, now: number = Date.now()): void {
  if (attempt.outcome !== 'failed') return;

  // Desktop: every failure goes to the app's log file.
  getElectronAPI()?.logVoiceEvent?.({
    level: 'warn',
    event: 'join-failed',
    data: {
      target: attempt.target.type,
      quiet: attempt.quiet,
      durationMs: attempt.durationMs,
      errorKind: attempt.errorKind,
      errorMessage: attempt.errorMessage?.slice(0, MESSAGE_MAX),
    },
  });

  if (now - lastReportedAt < JOIN_FAILURE_REPORT_INTERVAL_MS) return;
  lastReportedAt = now;

  const candidateTypes = candidateTypesOf(attempt.ice);
  voiceDiagnosticsControllerReportJoinFailure({
    body: {
      errorClass: attempt.errorKind ?? VoiceFailureKind.Unknown,
      message: (attempt.errorMessage ?? '').slice(0, MESSAGE_MAX),
      durationMs: Math.max(0, Math.round(attempt.durationMs)),
      candidateTypes: candidateTypes.length > 0 ? candidateTypes : undefined,
      platform: isElectron() ? 'electron' : 'web',
      os: osName(),
      appVersion: appVersion().slice(0, 64),
      channelId: attempt.target.type === 'channel' ? attempt.target.channelId : undefined,
      isDm: attempt.target.type === 'dm',
    },
  }).catch((err: unknown) => logger.debug?.('[Voice] Join-failure report not sent:', err));
}

/** Tests only. */
export function resetJoinFailureReporting(): void {
  lastReportedAt = Number.NEGATIVE_INFINITY;
}
