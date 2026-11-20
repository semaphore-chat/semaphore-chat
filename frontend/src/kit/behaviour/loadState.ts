/**
 * What a screen shows while it loads from the server: loading, empty, error,
 * ready or refreshing. An error only replaces the screen when there is
 * nothing to show.
 *
 * A direct port of the `loadState` reducers in `design/gen/behaviour_ref.py`;
 * the rule numbers below are that pattern's rules. Pure: it never mutates the
 * state it is given, never reads a clock and never makes an id. A fetch is an
 * effect that comes back as a `succeeded` or `failed` event with its token.
 */

import { requireEvent } from './event';

export type Status = 'loading' | 'empty' | 'error' | 'ready' | 'refreshing';

export interface State {
  /** `refreshing` still shows the old content. */
  status: Status;
  /** The message the error screen shows. */
  error: string | null;
  /** The token of the latest fetch; only its result counts. */
  token: number;
  /** A fetch is in flight. */
  fetching: boolean;
  /** A refresh the user started is in flight; shows busy on its control. */
  refreshByUser: boolean;
}

/** An event is an object with exactly one key, its name. */
export type Event =
  | { start: Record<string, never> }
  | { refresh: { byUser: boolean } }
  | { retry: Record<string, never> }
  | { succeeded: { token: number; empty: boolean } }
  | { failed: { token: number; message: string } };

export type Effect =
  | { fetch: { token: number } }
  | { notify: { id: string; message: string } };

export interface Params {
  /** The toast id repeated failures reuse, so they replace one toast. */
  notifyId: string;
}

const EVENT_NAMES = ['start', 'refresh', 'retry', 'succeeded', 'failed'] as const;

export const DEFAULT_PARAMS: Params = { notifyId: 'load' };

export function initialLoadState(_params: Params = DEFAULT_PARAMS): State {
  // Rule 1: a screen starts as loading, before any fetch.
  return { status: 'loading', error: null, token: 0, fetching: false, refreshByUser: false };
}

function fetch(state: State, status: Status, effects: Effect[], byUser = false): void {
  state.status = status;
  state.error = null;
  state.token += 1;
  state.fetching = true;
  // Rule 12: refreshByUser is true only while a refresh the user started is in flight.
  state.refreshByUser = byUser;
  effects.push({ fetch: { token: state.token } });
}

export function stepLoadState(
  state: State,
  event: Event,
  params: Params = DEFAULT_PARAMS,
): { state: State; effects: Effect[] } {
  requireEvent('loadState', event, EVENT_NAMES);
  const next: State = { ...state };
  const effects: Effect[] = [];
  const { status } = next;

  if ('start' in event) {
    // Rule 2: start, from any state, discards what is shown and fetches.
    fetch(next, 'loading', effects);
  } else if ('refresh' in event) {
    const { byUser } = event.refresh;
    if (next.fetching) {
      // Rule 6: refresh while a fetch is in flight starts no new fetch; one the
      // user started marks the fetch in flight as theirs, unless it is loading.
      if (byUser && status !== 'loading') next.refreshByUser = true;
    } else if (status === 'ready') {
      // Rule 3: refresh while ready keeps the content on screen: refreshing.
      fetch(next, 'refreshing', effects, byUser);
    } else if (status === 'empty') {
      // Rule 4: refresh while empty keeps the empty screen.
      fetch(next, 'empty', effects, byUser);
    } else if (status === 'error') {
      // Rule 5: refresh while error is a retry.
      fetch(next, 'loading', effects);
    }
  } else if ('retry' in event) {
    // Rule 7: retry while error loads again; in any other state it does nothing.
    if (status === 'error' && !next.fetching) fetch(next, 'loading', effects);
  } else if ('succeeded' in event) {
    // Rule 11: a stale token, or a result when nothing is in flight, does nothing.
    if (next.fetching && event.succeeded.token === next.token) {
      next.fetching = false;
      // Rule 12: any result clears refreshByUser.
      next.refreshByUser = false;
      // Rule 8: success shows the empty screen or the content.
      next.status = event.succeeded.empty ? 'empty' : 'ready';
    }
  } else if ('failed' in event) {
    // Rule 11: as above.
    if (next.fetching && event.failed.token === next.token) {
      next.fetching = false;
      // Rule 12: any result clears refreshByUser.
      next.refreshByUser = false;
      if (status === 'loading') {
        // Rule 9: failure with nothing to show replaces the skeleton with the error.
        next.status = 'error';
        next.error = event.failed.message;
      } else {
        // Rule 10: failure during a refresh keeps what is shown and notifies,
        // with the screen's stable notifyId so repeated failures replace one toast.
        next.status = status === 'refreshing' ? 'ready' : status;
        effects.push({ notify: { id: params.notifyId, message: event.failed.message } });
      }
    }
  }

  return { state: next, effects };
}
