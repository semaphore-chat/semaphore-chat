import type { VoiceFailureKind } from '../../contexts/VoiceContext';
import type { IceSummary } from './iceSummary';

/**
 * Ring buffer of recent voice join attempts. The voice event log only starts
 * once a Room exists; join failures happen before that, so they're kept here
 * (and included in "Export diagnostics").
 */

export const JOIN_ATTEMPT_LOG_SIZE = 20;

export interface JoinAttempt {
  /** Epoch ms when the attempt started. */
  startedAt: number;
  target: { type: 'channel'; channelId: string } | { type: 'dm'; dmGroupId: string };
  /** An automatic rejoin after a drop. */
  quiet: boolean;
  durationMs: number;
  outcome: 'success' | 'failed' | 'cancelled';
  errorKind?: VoiceFailureKind;
  errorMessage?: string;
  /** The ICE path, read after a successful connect. */
  ice?: IceSummary | null;
}

let attempts: JoinAttempt[] = [];

export function recordJoinAttempt(attempt: JoinAttempt): JoinAttempt {
  attempts = [...attempts, attempt].slice(-JOIN_ATTEMPT_LOG_SIZE);
  return attempt;
}

/** Attach the ICE summary to an attempt once it's known (it arrives after the connect). */
export function setJoinAttemptIce(attempt: JoinAttempt, ice: IceSummary | null): void {
  attempts = attempts.map((a) => (a === attempt ? { ...a, ice } : a));
}

/** Oldest first. */
export function getJoinAttempts(): JoinAttempt[] {
  return attempts;
}

/** Tests only. */
export function resetJoinAttempts(): void {
  attempts = [];
}
