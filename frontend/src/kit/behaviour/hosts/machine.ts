/**
 * Runs a reducer the way `design/guide/behaviour.md` ("Applying a step") says:
 * send one event, store the new state, apply the effects one by one in order.
 * An event sent while a step is being applied (by an effect, or by a
 * subscriber) is queued and runs after every effect of the step. The reducer is
 * never re-entered.
 */
export interface Machine<S, E> {
  getState(): S;
  /** While a step is being applied the event is queued and sent after it. */
  send(event: E): void;
  /** For `useSyncExternalStore`: called after each step stores its state. */
  subscribe(listener: () => void): () => void;
}

export function createMachine<S, E, F, P>(
  step: (state: S, event: E, params: P) => { state: S; effects: F[] },
  initial: S,
  params: P,
  apply: (effect: F, send: (event: E) => void) => void,
): Machine<S, E> {
  let state = initial;
  let busy = false;
  const queue: E[] = [];
  const listeners = new Set<() => void>();

  function send(event: E): void {
    queue.push(event);
    if (busy) return;
    busy = true;
    try {
      while (queue.length > 0) {
        const result = step(state, queue.shift() as E, params);
        state = result.state;
        // Copy: a listener may unsubscribe while we notify.
        [...listeners].forEach((listener) => listener());
        result.effects.forEach((effect) => apply(effect, send));
      }
    } catch (error) {
      // Effects should never throw. If one does, the events queued behind it
      // are dropped so the machine is not left half-way, and the error surfaces.
      queue.length = 0;
      throw error;
    } finally {
      busy = false;
    }
  }

  return {
    getState: () => state,
    send,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
