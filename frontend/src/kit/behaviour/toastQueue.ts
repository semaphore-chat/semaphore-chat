/**
 * The toast queue: one toast on screen at a time, the rest waiting in order.
 *
 * A direct port of the `toastQueue` reducers in `design/gen/behaviour_ref.py`;
 * the rule numbers below are that pattern's rules. Pure: it never mutates the
 * state it is given, never reads a clock and never makes an id. A timer is an
 * effect that comes back as a `timerFired` event.
 */

import { tokens } from '../../theme/generated/tokens';
import { requireEvent } from './event';

export type ToastTone = 'neutral' | 'positive' | 'danger';
export type Politeness = 'polite' | 'assertive';

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
  action: string | null;
}

export interface State {
  /** The toast on screen. */
  showing: Toast | null;
  /** The toasts waiting, oldest first. */
  queue: Toast[];
  /** The pointer or focus is on the toast area; false whenever nothing is showing. */
  paused: boolean;
  /** The token of the latest timer; only that one counts when it fires. */
  token: number;
}

/** An event is an object with exactly one key, its name. */
export type Event =
  | { show: { toast: Toast } }
  | { dismiss: { id: string } }
  | { timerFired: { token: number } }
  | { pause: Record<string, never> }
  | { resume: Record<string, never> };

export type Effect =
  | { startTimer: { token: number; ms: number } }
  | { cancelTimer: { token: number } }
  | { announce: { message: string; politeness: Politeness } };

export interface Params {
  durationMs: number;
  durationWithActionMs: number;
  maxQueued: number;
}

const EVENT_NAMES = ['show', 'dismiss', 'timerFired', 'pause', 'resume'] as const;

export const DEFAULT_PARAMS: Params = {
  durationMs: tokens.motion.toast,
  durationWithActionMs: tokens.motion.toastAction,
  maxQueued: 3,
};

export function initialToastQueue(_params: Params = DEFAULT_PARAMS): State {
  return { showing: null, queue: [], paused: false, token: 0 };
}

/** Rules 6 and 7: how long `toast` stays; a toast with an action or a danger toast stays longer. */
function toastMs(toast: Toast, params: Params): number {
  if (toast.action !== null || toast.tone === 'danger') return params.durationWithActionMs;
  return params.durationMs;
}

/**
 * Rules 1, 3, 7 and 13: put `toast` on screen with a fresh token, its timer
 * (unless paused) and its announcement. A danger toast is announced
 * assertively, every other toast politely.
 */
function present(state: State, toast: Toast, params: Params, effects: Effect[]): void {
  state.showing = toast;
  state.token += 1;
  if (!state.paused) {
    effects.push({ startTimer: { token: state.token, ms: toastMs(toast, params) } });
  }
  effects.push({
    announce: {
      message: toast.message,
      politeness: toast.tone === 'danger' ? 'assertive' : 'polite',
    },
  });
}

/** Rules 8 and 13: the showing toast has gone; show the next queued one, or nothing. */
function leave(state: State, params: Params, effects: Effect[]): void {
  const next = state.queue.shift();
  if (next !== undefined) {
    present(state, next, params, effects);
  } else {
    state.showing = null;
    state.paused = false;
  }
}

export function stepToastQueue(
  state: State,
  event: Event,
  params: Params = DEFAULT_PARAMS,
): { state: State; effects: Effect[] } {
  requireEvent('toastQueue', event, EVENT_NAMES);
  const next: State = {
    showing: state.showing,
    queue: [...state.queue],
    paused: state.paused,
    token: state.token,
  };
  const effects: Effect[] = [];
  const showing = next.showing;

  if ('show' in event) {
    const toast: Toast = { ...event.show.toast };
    if (showing === null) {
      // Rule 1: shown while nothing is showing, it appears at once.
      present(next, toast, params, effects);
    } else if (showing.id === toast.id) {
      // Rule 3: the same id as the showing toast replaces it in place.
      if (!next.paused) effects.push({ cancelTimer: { token: next.token } });
      present(next, toast, params, effects);
    } else {
      const at = next.queue.findIndex((item) => item.id === toast.id);
      if (at !== -1) {
        // Rule 4: the same id as a queued toast replaces it in its place.
        next.queue[at] = toast;
      } else {
        // Rule 2: it waits at the end of the queue.
        next.queue.push(toast);
        // Rule 5: past maxQueued, drop the oldest queued toast that is not danger.
        if (next.queue.length > params.maxQueued) {
          const drop = next.queue.findIndex((item) => item.tone !== 'danger');
          next.queue.splice(drop === -1 ? 0 : drop, 1);
        }
      }
    }
  } else if ('dismiss' in event) {
    const { id } = event.dismiss;
    if (showing !== null && showing.id === id) {
      // Rule 8: dismissing the showing toast cancels its timer and brings the next one in.
      if (!next.paused) effects.push({ cancelTimer: { token: next.token } });
      leave(next, params, effects);
    } else {
      // Rule 9: dismissing a queued toast removes it; an unknown id does nothing.
      next.queue = next.queue.filter((item) => item.id !== id);
    }
  } else if ('timerFired' in event) {
    // Rule 10: the current token makes the toast leave as if dismissed.
    if (showing !== null && !next.paused && event.timerFired.token === next.token) {
      leave(next, params, effects);
    }
  } else if ('pause' in event) {
    // Rule 11: pause cancels the timer; while already paused or nothing shows it does nothing.
    if (showing !== null && !next.paused) {
      next.paused = true;
      effects.push({ cancelTimer: { token: next.token } });
    }
  } else if (next.paused && showing !== null) {
    // Rule 12: resume starts the timer again with the full duration and a new token.
    // (A pause belongs to a showing toast, so `showing` is the toast to time.)
    next.paused = false;
    next.token += 1;
    effects.push({ startTimer: { token: next.token, ms: toastMs(showing, params) } });
  }

  return { state: next, effects };
}
