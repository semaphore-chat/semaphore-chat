import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  initialLoadState,
  stepLoadState,
  type Effect,
  type Event,
  type Params,
  type State,
  type Status,
} from '../loadState';
import { useBehaviourHost } from './hostContext';
import { createMachine, type Machine } from './machine';
import type { ToastRequest } from './toasts';

export interface LoadController {
  status: Status;
  /** The message the error screen shows; null unless `status` is `error`. */
  error: string | null;
  /**
   * Whether the error screen offers Try again. False for a first load that
   * failed because the device is offline: it loads by itself when the
   * connection returns, and Try again would only fail again.
   */
  retryable: boolean;
  /** A refresh the user started is in flight: show it on the refresh button's `loading`. */
  refreshByUser: boolean;
  /** A refresh button or pull to refresh. */
  refresh: () => void;
  /** Try again on the error screen. */
  retry: () => void;
}

/**
 * What a screen shows, built from ids: `channelId`, or `` `${communityId}:${channelId}` ``.
 * It is compared by value; a change loads from scratch. It must change in the
 * same render as the query key.
 */
export type ResetKey = string | number;

/** NaN (`Number(missingId)`) is a programming error: it would name no subject. */
function checkResetKey(key: ResetKey): void {
  if (typeof key === 'number' && Number.isNaN(key)) {
    throw new TypeError('resetKey is NaN: build it from ids that exist (see ResetKey).');
  }
}

/** The default body under the error title ("Couldn't load members"). */
export const DEFAULT_ERROR_MESSAGE = 'Try again.';
/** A first load that cannot start because the device is offline. */
export const OFFLINE_LOAD_MESSAGE = "You're offline. It will load when you're back online.";
/** A refresh that cannot start because the device is offline (a toast). */
export const OFFLINE_REFRESH_MESSAGE = "You're offline. It will refresh when you're back online.";

export interface LoadStateOptions {
  /** The toast id this screen's refresh failures share, so repeats replace one toast. */
  notifyId: string;
  /** What the screen shows (see `ResetKey`). A change loads from scratch. */
  resetKey: ResetKey;
  /** The text for a failure. Default: "Try again." (the title already says what failed). */
  errorMessage?: (error: unknown) => string;
}

export interface UseLoadStateOptions<T> extends LoadStateOptions {
  /** Fetches the data. The signal aborts when a newer fetch starts or the screen goes away. */
  load: (signal: AbortSignal) => Promise<T>;
  /** Whether the answer has nothing in it (the empty state). */
  isEmpty: (data: T) => boolean;
}

export interface UseQueryLoadStateOptions<T> extends LoadStateOptions {
  isEmpty: (data: T) => boolean;
}

export interface LoadStateResult<T> {
  /** For `<LoadState state={...}>` and the refresh button. */
  state: LoadController;
  /** The answer of the current load: undefined until it succeeds and after `resetKey` changes. */
  data: T | undefined;
}

function messageOf(options: LoadStateOptions, error: unknown): string {
  try {
    return (options.errorMessage ?? (() => DEFAULT_ERROR_MESSAGE))(error);
  } catch {
    return DEFAULT_ERROR_MESSAGE;
  }
}

/** Which event asked for a fetch: one the hook observed (open, a key change, a refetch the query started) or one the user did. */
type Cause = 'observe' | 'act';

export interface LoadCore {
  machine: Machine<State, Event>;
  params: Params;
  /** How `fetch{token}` is carried out; set by the hook. It reads `cause` for why. */
  fetcher: { current: (token: number, cause: Cause) => void };
  options: { current: LoadStateOptions };
  /** Sends a result unless the screen is gone. */
  report: (event: Event) => void;
  /** Sends an event the user caused (refresh, retry): its fetch is told `act`. */
  act: (event: Event) => void;
  dispose: () => void;
  revive: () => void;
}

/** The load machine with its two seams: how a fetch is carried out, and where `notify` goes. */
export function createLoadCore(
  initial: LoadStateOptions,
  notify: (request: ToastRequest) => void,
): LoadCore {
  const params: Params = { notifyId: initial.notifyId };
  const fetcher: LoadCore['fetcher'] = { current: () => {} };
  let disposed = false;
  let cause: Cause = 'observe';
  const machine = createMachine<State, Event, Effect, Params>(
    stepLoadState,
    initialLoadState(params),
    params,
    (effect) => {
      if ('fetch' in effect) fetcher.current(effect.fetch.token, cause);
      else notify({ id: effect.notify.id, tone: 'danger', message: effect.notify.message });
    },
  );
  return {
    machine,
    params,
    fetcher,
    options: { current: initial },
    report(event) {
      if (!disposed) machine.send(event);
    },
    act(event) {
      cause = 'act';
      try {
        machine.send(event);
      } finally {
        cause = 'observe';
      }
    },
    dispose() {
      disposed = true;
    },
    revive() {
      disposed = false;
    },
  };
}

/**
 * The controller the screen sees. `stale`: `resetKey` changed in this render and
 * `start` has not been sent yet; it already reads as loading, so the old
 * subject's face never shows with the new subject's data.
 */
function useController(core: LoadCore, stale: boolean, offline: () => boolean): LoadController {
  const { machine } = core;
  const state = useSyncExternalStore(machine.subscribe, machine.getState);
  // The offline flag only changes together with the state (it is set just before the failure is sent).
  const retryable = !(state.status === 'error' && offline());
  return useMemo<LoadController>(
    () => ({
      status: stale ? 'loading' : state.status,
      error: stale ? null : state.error,
      retryable: stale || retryable,
      refreshByUser: stale ? false : state.refreshByUser,
      refresh: () => core.act({ refresh: { byUser: true } }),
      retry: () => core.act({ retry: {} }),
    }),
    [core, stale, state.status, state.error, state.refreshByUser, retryable],
  );
}

function useLifetime(core: LoadCore, options: LoadStateOptions): void {
  useLayoutEffect(() => {
    core.params.notifyId = options.notifyId;
    core.options.current = options;
  });
  useEffect(() => {
    core.revive();
    return () => core.dispose();
  }, [core]);
}

/**
 * Loading, empty, error, ready and refreshing for a screen that fetches with its
 * own function (`design/guide/behaviour.md`, "Load state"). Pass `state` to
 * `<LoadState>` and draw `data`: only the current load's answer is kept, so a
 * late answer for an earlier `resetKey` never shows.
 */
export function useLoadState<T>(options: UseLoadStateOptions<T>): LoadStateResult<T> {
  checkResetKey(options.resetKey);
  const host = useBehaviourHost();
  const [s] = useState(() => ({
    core: createLoadCore(options, (request) => host.toasts.toasts.show(request)),
    options,
    running: null as AbortController | null,
    data: undefined as T | undefined,
    // The key `start` was last sent for; null before the first.
    startedKey: null as ResetKey | null,
  }));
  const { core } = s;
  useLifetime(core, options);
  useLayoutEffect(() => {
    s.options = options;
  });

  useLayoutEffect(() => {
    core.fetcher.current = (token) => {
      s.running?.abort();
      const abort = new AbortController();
      s.running = abort;
      let loading: Promise<T>;
      try {
        loading = Promise.resolve(s.options.load(abort.signal));
      } catch (error) {
        loading = Promise.reject(error);
      }
      const current = () => !abort.signal.aborted && core.machine.getState().token === token;
      loading.then(
        (data) => {
          if (!current()) return;
          let empty: boolean;
          try {
            empty = s.options.isEmpty(data);
          } catch (error) {
            core.report({ failed: { token, message: messageOf(core.options.current, error) } });
            return;
          }
          s.data = data;
          core.report({ succeeded: { token, empty } });
        },
        (error: unknown) => {
          if (current()) core.report({ failed: { token, message: messageOf(core.options.current, error) } });
        },
      );
    };
  }, [core, s]);

  // Opening the screen and changing what it shows both load from scratch.
  // A layout effect, so a key change never paints the old subject.
  useLayoutEffect(() => {
    if (s.startedKey !== null && Object.is(s.startedKey, options.resetKey)) return;
    s.startedKey = options.resetKey;
    s.data = undefined;
    core.machine.send({ start: {} });
  }, [core, s, options.resetKey]);
  useEffect(
    () => () => {
      s.running?.abort();
      // A remount (strict mode) loads again.
      s.startedKey = null;
    },
    [s],
  );

  const stale = s.startedKey !== null && !Object.is(s.startedKey, options.resetKey);
  const state = useController(core, stale, () => false);
  return { state, data: stale ? undefined : s.data };
}

function settledAtOf(query: UseQueryResult<unknown>): number {
  return Math.max(query.dataUpdatedAt, query.errorUpdatedAt);
}

interface Pending {
  token: number;
  /** When the query last settled, as the fetch was asked for. */
  baseline: number;
  /** The user asked: `refetch()` was called, so the result in hand is not the answer yet. */
  act: boolean;
  /** The query has been seen fetching (or paused) for it. */
  sawFetch: boolean;
  /** `refetch()` was called once to resume a first load a cancel reverted; never twice. */
  resumed: boolean;
}

interface Seen {
  key: ResetKey;
  fetchStatus: UseQueryResult<unknown>['fetchStatus'];
  settledAt: number;
}

interface QueryHost<T> {
  core: LoadCore;
  query: UseQueryResult<T>;
  isEmpty: (data: T) => boolean;
  /** Our fetch waiting for the query; null when the query's fetch is not ours. */
  pending: Pending | null;
  /** What the last layout effect saw. */
  seen: Seen;
  /** The error on screen is the offline first-load failure: it loads by itself on reconnect, so no Try again. */
  offline: boolean;
  /**
   * The cache was shown at open while the query's refetch was paused (offline). That refetch is a
   * background refresh whose failure is a toast; the layout effect reports it, never render.
   */
  pausedAtOpen: boolean;
}

/**
 * Settles our pending fetch from the query result in hand, if it is an answer.
 * A fetch in flight, a disabled query with no answer, a reverted (cancelled)
 * first load and a `refetch()` that has not shown up yet are not answers: the
 * token stays pending. A paused fetch is checked before the answer in hand: a
 * paused refresh is a failure, not the old cache again.
 */
function settle<T>(h: QueryHost<T>): void {
  const p = h.pending;
  if (p === null) return;
  const { core, query } = h;
  if (query.fetchStatus === 'fetching') {
    p.sawFetch = true;
    return;
  }
  if (query.fetchStatus === 'paused') {
    // Offline (TanStack's networkMode 'online' pauses instead of failing): a failed attempt.
    // The resumed fetch arrives later as a refetch the query started.
    h.pending = null;
    const loading = core.machine.getState().status === 'loading';
    h.offline = loading;
    core.report({ failed: { token: p.token, message: loading ? OFFLINE_LOAD_MESSAGE : OFFLINE_REFRESH_MESSAGE } });
    return;
  }
  const changed = settledAtOf(query) !== p.baseline;
  // Our refetch() has not reached the result yet: what is in hand is the old answer.
  if (p.act && !p.sawFetch && !changed) return;
  const reverted = p.sawFetch && !changed;
  if (query.status === 'success' && !query.isPlaceholderData) {
    // A revert during a refresh restores what was shown; it ends the refresh with that.
    h.pending = null;
    let empty: boolean;
    try {
      empty = h.isEmpty(query.data);
    } catch (error) {
      core.report({ failed: { token: p.token, message: messageOf(core.options.current, error) } });
      return;
    }
    core.report({ succeeded: { token: p.token, empty } });
    return;
  }
  // A disabled query with no answer (a dependent query whose id has not arrived, or a cached
  // error that Try again could not fetch) waits on the skeleton.
  if (!query.isEnabled) return;
  if (query.status === 'error' && !reverted) {
    h.pending = null;
    core.report({ failed: { token: p.token, message: messageOf(core.options.current, query.error) } });
    return;
  }
  if (reverted && query.status === 'pending' && !p.resumed) {
    // A first load a cancel reverted, with nothing to show and nothing else to fetch it: resume it once.
    p.resumed = true;
    p.act = true;
    p.sawFetch = false;
    p.baseline = settledAtOf(query);
    query.refetch().catch(() => {});
  }
  // Otherwise (a second revert, or a revert to an old error): not a result; the skeleton stays.
}

/**
 * A load machine for one subject (one `resetKey`), already started from the
 * query result in hand. Starting only observes (it never calls `refetch()`), so
 * making one has no effect outside it, and it can be made during render.
 */
function createQueryHost<T>(
  query: UseQueryResult<T>,
  options: UseQueryLoadStateOptions<T>,
  notify: (request: ToastRequest) => void,
): QueryHost<T> {
  const core = createLoadCore(options, notify);
  const created: QueryHost<T> = {
    core,
    query,
    isEmpty: options.isEmpty,
    pending: null,
    seen: { key: options.resetKey, fetchStatus: query.fetchStatus, settledAt: settledAtOf(query) },
    offline: false,
    pausedAtOpen: false,
  };
  core.fetcher.current = (token, cause) => {
    const current = created.query;
    created.offline = false;
    if (
      cause === 'observe' &&
      core.machine.getState().status === 'loading' &&
      current.data !== undefined &&
      !current.isPlaceholderData
    ) {
      // Opening on data in the cache shows it, whatever the query is doing: fresh, disabled, offline,
      // or last refetch failed. A refetch on its way (or paused, offline) is a background refresh, so
      // its failure is a toast, never the error screen over data the screen has.
      let empty: boolean;
      try {
        empty = created.isEmpty(current.data);
      } catch (error) {
        core.report({ failed: { token, message: messageOf(core.options.current, error) } });
        return;
      }
      core.report({ succeeded: { token, empty } });
      // A fetch on its way is joined at once (joining tells no one). A paused one would fail into a
      // toast, and this may run during render: the layout effect reports it instead.
      if (current.fetchStatus === 'fetching') core.report({ refresh: { byUser: false } });
      else if (current.fetchStatus === 'paused') created.pausedAtOpen = true;
      return;
    }
    const act = cause === 'act' && current.isEnabled && current.fetchStatus === 'idle';
    created.pending = { token, baseline: settledAtOf(current), act, sawFetch: false, resumed: false };
    if (act) {
      current.refetch().catch(() => {});
      return;
    }
    settle(created);
  };
  // Before the first render: a cache hit (or an offline first load) is the first face painted.
  core.machine.send({ start: {} });
  return created;
}

/**
 * The same for a TanStack Query result. It observes the query and never fetches
 * by itself: opening the screen or changing `resetKey` joins the query's own
 * fetch, or answers from its cache at once (no skeleton, no request). Only Try
 * again and a refresh the user starts call `refetch()`, and only while the query
 * is enabled. A refetch the query starts by itself (focus, reconnect,
 * invalidation, `setQueryData`) is a background refresh. Data in the cache shows
 * at open whatever the query is doing; a disabled query with no answer reads as
 * loading. A paused (offline) fetch is a failure, with the offline wording: a
 * first load shows it with no Try again (TanStack resumes it on reconnect), a
 * refresh notifies.
 */
export function useQueryLoadState<T>(
  query: UseQueryResult<T>,
  options: UseQueryLoadStateOptions<T>,
): LoadController {
  checkResetKey(options.resetKey);
  const host = useBehaviourHost();
  const notify = (request: ToastRequest) => host.toasts.toasts.show(request);
  const [h, setHost] = useState(() => createQueryHost(query, options, notify));
  if (!Object.is(h.seen.key, options.resetKey)) {
    // What the screen shows changed: a fresh machine, started from this render's query, so the
    // first commit for the new key is already its face (a cache hit is ready at once). React
    // drops this render and renders again with it; the old one is disposed by its effect.
    setHost(createQueryHost(query, options, notify));
  }
  const { core } = h;
  useLifetime(core, options);

  useLayoutEffect(() => {
    h.query = query;
    h.isEmpty = options.isEmpty;
    const previous = h.seen;
    const now: Seen = { key: options.resetKey, fetchStatus: query.fetchStatus, settledAt: settledAtOf(query) };
    h.seen = now;
    if (h.pending !== null) {
      settle(h);
      return;
    }
    if (h.pausedAtOpen) {
      h.pausedAtOpen = false;
      if (now.fetchStatus === 'paused') {
        core.report({ refresh: { byUser: false } });
        return;
      }
    }
    // Not ours: the query fetched by itself (focus, reconnect, invalidation, a resumed offline fetch).
    if (now.fetchStatus === 'fetching' && previous.fetchStatus !== 'fetching') {
      core.report({ refresh: { byUser: false } });
    } else if (now.fetchStatus === 'idle' && now.settledAt !== previous.settledAt) {
      // It ended before we saw it start, or the data was set by hand (`setQueryData`): settled at once.
      core.report({ refresh: { byUser: false } });
    }
  });

  // A key change made a new host above, so this one is never stale.
  return useController(core, false, () => h.offline);
}
