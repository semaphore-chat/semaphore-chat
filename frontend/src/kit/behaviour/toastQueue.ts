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
  | { dismiss: { id: string; focusInside: boolean } }
  | { timerFired: { token: number } }
  | { pause: Record<string, never> }
  | { resume: Record<string, never> };

export type Effect =
  | { startTimer: { token: number; ms: number } }
  | { cancelTimer: { token: number } }
  | { announce: { message: string; politeness: Politeness; action: string | null } }
  | { returnFocus: Record<string, never> };

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

/**
 * Rules 6 and 7: how long `toast` stays, or null when it has no timer and
 * stays until dismissed. A danger toast with an action never dismisses
 * itself; a danger toast without one stays for `durationWithActionMs`.
 */
function toastMs(toast: Toast, params: Params): number | null {
  if (toast.tone === 'danger') {
    return toast.action !== null ? null : params.durationWithActionMs;
  }
  return toast.action !== null ? params.durationWithActionMs : params.durationMs;
}

/** A timer starts for the showing toast only while it is on screen, unpaused, and has one. */
function timerRunning(state: State, params: Params): boolean {
  return state.showing !== null && !state.paused && toastMs(state.showing, params) !== null;
}

/**
 * Rules 1, 3, 7 and 13: put `toast` on screen with a fresh token, its timer
 * (unless paused or absent) and, when asked, its announcement.
 */
function present(
  state: State,
  toast: Toast,
  params: Params,
  effects: Effect[],
  announce = true,
): void {
  state.showing = toast;
  state.token += 1;
  const ms = toastMs(toast, params);
  // Rule 13: a toast that takes the place of a dismissed one while paused
  // shows without a timer until resume.
  if (!state.paused && ms !== null) {
    effects.push({ startTimer: { token: state.token, ms } });
  }
  if (announce) {
    // Rule 14: every announcement carries the toast's action label, or null.
    effects.push({
      // Rule 7: a danger toast is announced assertively, every other toast politely.
      announce: {
        message: toast.message,
        politeness: toast.tone === 'danger' ? 'assertive' : 'polite',
        action: toast.action,
      },
    });
  }
}

/** Rules 8 and 13: the showing toast has gone; show the next queued one, or nothing. */
function leave(state: State, params: Params, effects: Effect[]): void {
  const next = state.queue.shift();
  if (next !== undefined) {
    present(state, next, params, effects);
  } else {
    state.showing = null;
    // Rule 13: when the last toast leaves, the pause ends.
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
      // Rule 3: the same id as the showing toast replaces it in place: its old
      // timer (if any) is cancelled and it is announced only when the message
      // or the action changed.
      if (timerRunning(next, params)) {
        effects.push({ cancelTimer: { token: next.token } });
      }
      const changed = showing.message !== toast.message || showing.action !== toast.action;
      present(next, toast, params, effects, changed);
    } else {
      const at = next.queue.findIndex((item) => item.id === toast.id);
      if (at !== -1) {
        // Rule 4: the same id as a queued toast replaces it in its place.
        next.queue[at] = toast;
      } else {
        const waiting = next.queue;
        if (waiting.length >= params.maxQueued) {
          // Rule 5: when the queue is full, drop the oldest waiting toast with
          // no action that is not danger; failing that, the oldest waiting
          // non-danger toast. Never the incoming toast or a danger toast: with
          // only danger waiting, the queue grows.
          const plain = waiting.findIndex((item) => item.tone !== 'danger' && item.action === null);
          const other = waiting.findIndex((item) => item.tone !== 'danger');
          const drop = plain !== -1 ? plain : other;
          if (drop !== -1) waiting.splice(drop, 1);
        }
        // Rule 2: it waits at the end of the queue; nothing is announced until it shows.
        waiting.push(toast);
      }
    }
  } else if ('dismiss' in event) {
    const { id, focusInside } = event.dismiss;
    if (showing !== null && showing.id === id) {
      // Rule 8: dismissing the showing toast cancels its timer (when it has
      // one) and shows the next queued toast, or nothing.
      if (timerRunning(next, params)) {
        effects.push({ cancelTimer: { token: next.token } });
      }
      // Rule 16: focus that was inside the toast area goes back where it was.
      if (focusInside) effects.push({ returnFocus: {} });
      leave(next, params, effects);
    } else {
      // Rule 9: dismissing a queued toast removes it; an unknown id does nothing.
      next.queue = next.queue.filter((item) => item.id !== id);
    }
  } else if ('timerFired' in event) {
    // Rule 10: the current token makes the toast leave as if dismissed,
    // without a cancelTimer; any other token does nothing.
    if (timerRunning(next, params) && event.timerFired.token === next.token) {
      leave(next, params, effects);
    }
  } else if ('pause' in event) {
    // Rule 11: pause cancels the timer (when there is one); while already
    // paused, or while nothing is showing, it does nothing.
    // Rule 15: the host sends one pause for all its reasons to pause.
    if (showing !== null && !next.paused) {
      if (timerRunning(next, params)) {
        effects.push({ cancelTimer: { token: next.token } });
      }
      next.paused = true;
    }
  } else if ('resume' in event) {
    // Rule 12: resume starts the timer again (when the toast has one) with the
    // full duration and a new token; while not paused it does nothing.
    if (next.paused) {
      next.paused = false;
      next.token += 1;
      const ms = showing === null ? null : toastMs(showing, params);
      if (ms !== null) effects.push({ startTimer: { token: next.token, ms } });
    }
  }

  return { state: next, effects };
}
