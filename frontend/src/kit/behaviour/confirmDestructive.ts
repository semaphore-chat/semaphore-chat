/**
 * The destructive confirmation: a dialog that asks before an irreversible
 * action, runs it, and stays open with the error when it fails.
 *
 * A direct port of the `confirmDestructive` reducers in
 * `design/gen/behaviour_ref.py`; the rule numbers below are that pattern's
 * rules. Pure: it never mutates the state it is given.
 */

import { requireEvent } from './event';

export type Phase = 'idle' | 'confirming' | 'working' | 'failed';
export type CancelReason = 'button' | 'escape' | 'scrim';

export interface State {
  /** `idle` is closed; the others show the dialog. */
  phase: Phase;
  /** The failure shown in the dialog. */
  error: string | null;
  /** The number of the latest run; only its result counts. */
  attempt: number;
}

/** An event is an object with exactly one key, its name. */
export type Event =
  | { request: Record<string, never> }
  | { confirm: Record<string, never> }
  | { cancel: { reason: CancelReason } }
  | { succeeded: { attempt: number } }
  | { failed: { attempt: number; message: string } };

export type Effect = { run: { attempt: number } } | { done: Record<string, never> };

/** The confirmation has no settings. */
export type Params = Record<string, never>;

const EVENT_NAMES = ['request', 'confirm', 'cancel', 'succeeded', 'failed'] as const;

export const DEFAULT_PARAMS: Params = {};

export function initialConfirmDestructive(_params: Params = DEFAULT_PARAMS): State {
  return { phase: 'idle', error: null, attempt: 0 };
}

export function stepConfirmDestructive(
  state: State,
  event: Event,
  _params: Params = DEFAULT_PARAMS,
): { state: State; effects: Effect[] } {
  requireEvent('confirmDestructive', event, EVENT_NAMES);
  const next: State = { ...state };
  const effects: Effect[] = [];
  const { phase } = next;

  if ('request' in event) {
    // Rule 1: request opens the closed dialog; while it is open it does nothing.
    if (phase === 'idle') next.phase = 'confirming';
  } else if ('confirm' in event) {
    // Rule 2: confirm while confirming starts the action.
    // Rule 8: confirm while failed retries, with the error cleared.
    // Rule 3: while working, a second confirm does nothing.
    if (phase === 'confirming' || phase === 'failed') {
      next.phase = 'working';
      next.error = null;
      next.attempt += 1;
      effects.push({ run: { attempt: next.attempt } });
    }
  } else if ('cancel' in event) {
    // Rule 5: cancel while confirming or failed closes the dialog and clears the error.
    // Rule 4: while working, nothing closes the dialog.
    if (phase === 'confirming' || phase === 'failed') {
      next.phase = 'idle';
      next.error = null;
    }
  } else if ('succeeded' in event) {
    // Rule 9: a result for another attempt, or when nothing is working, does nothing.
    if (phase === 'working' && event.succeeded.attempt === next.attempt) {
      // Rule 6: success closes the dialog and emits done.
      next.phase = 'idle';
      effects.push({ done: {} });
    }
  } else if ('failed' in event) {
    // Rule 9: as above.
    if (phase === 'working' && event.failed.attempt === next.attempt) {
      // Rule 7: failure keeps the dialog open, showing the error.
      next.phase = 'failed';
      next.error = event.failed.message;
    }
  }

  return { state: next, effects };
}
