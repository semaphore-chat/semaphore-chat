/**
 * Timers for the hosts, keyed by (owner, token). Two reducers can hand out the
 * same token, so the owner (a machine) is part of the key. Cancelling is final:
 * a timer that was cancelled or replaced never calls `fire`, even if the
 * scheduler runs its callback anyway.
 */
export interface TimerService {
  start(owner: object, token: number, ms: number, fire: () => void): void;
  cancel(owner: object, token: number): void;
  disposeAll(owner: object): void;
}

export interface Scheduler {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

interface Entry {
  handle: unknown;
}

export function createTimerService(scheduler: Scheduler): TimerService {
  const owners = new WeakMap<object, Map<number, Entry>>();

  function cancel(owner: object, token: number): void {
    const timers = owners.get(owner);
    const entry = timers?.get(token);
    if (timers === undefined || entry === undefined) return;
    timers.delete(token);
    scheduler.clear(entry.handle);
  }

  return {
    start(owner, token, ms, fire) {
      cancel(owner, token);
      let timers = owners.get(owner);
      if (timers === undefined) {
        timers = new Map();
        owners.set(owner, timers);
      }
      const entry: Entry = { handle: undefined };
      entry.handle = scheduler.set(() => {
        // Stale: cancelled or replaced since this was scheduled.
        if (owners.get(owner)?.get(token) !== entry) return;
        owners.get(owner)?.delete(token);
        fire();
      }, ms);
      timers.set(token, entry);
    },
    cancel,
    disposeAll(owner) {
      const timers = owners.get(owner);
      if (timers === undefined) return;
      [...timers.keys()].forEach((token) => cancel(owner, token));
    },
  };
}

export const browserTimers: TimerService = createTimerService({
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});
