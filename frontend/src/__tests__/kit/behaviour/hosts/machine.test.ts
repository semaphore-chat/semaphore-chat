import { describe, expect, it, vi } from 'vitest';
import { createMachine } from '../../../../kit/behaviour/hosts/machine';

type Event = { add: number } | { chain: number[] };
type Effect = { log: string } | { send: Event };

/** Counts, and for `chain` asks for one effect per number that sends `add` back. */
function step(state: number, event: Event): { state: number; effects: Effect[] } {
  if ('add' in event) {
    return { state: state + event.add, effects: [{ log: `add ${event.add} -> ${state + event.add}` }] };
  }
  return {
    state,
    effects: [
      { log: 'chain start' },
      ...event.chain.map((n): Effect => ({ send: { add: n } })),
      { log: 'chain end' },
    ],
  };
}

describe('createMachine', () => {
  it('stores the new state before applying effects, in order', () => {
    const seen: string[] = [];
    const machine = createMachine<number, Event, Effect, null>(step, 0, null, (effect) => {
      if ('log' in effect) seen.push(`${effect.log} (state ${machine.getState()})`);
    });
    machine.send({ add: 2 });
    machine.send({ add: 3 });
    expect(seen).toEqual(['add 2 -> 2 (state 2)', 'add 3 -> 5 (state 5)']);
  });

  it('queues an event sent while effects apply, and sends it after every effect of the step', () => {
    const applied: string[] = [];
    const machine = createMachine<number, Event, Effect, null>(step, 0, null, (effect, send) => {
      if ('log' in effect) applied.push(effect.log);
      else send(effect.send);
    });
    machine.send({ chain: [1, 2] });
    expect(applied).toEqual(['chain start', 'chain end', 'add 1 -> 1', 'add 2 -> 3']);
    expect(machine.getState()).toBe(3);
  });

  it('never re-enters the step function', () => {
    let depth = 0;
    let maxDepth = 0;
    const machine = createMachine<number, Event, Effect, null>(
      (state, event) => {
        depth += 1;
        maxDepth = Math.max(maxDepth, depth);
        const result = step(state, event);
        depth -= 1;
        return result;
      },
      0,
      null,
      (effect, send) => {
        if ('send' in effect) send(effect.send);
      },
    );
    machine.send({ chain: [1, 2, 3] });
    expect(maxDepth).toBe(1);
  });

  it('queues events sent from a subscriber during a step too', () => {
    const states: number[] = [];
    const machine = createMachine<number, Event, Effect, null>(step, 0, null, () => {});
    let sentOnce = false;
    machine.subscribe(() => {
      states.push(machine.getState());
      if (!sentOnce) {
        sentOnce = true;
        machine.send({ add: 10 });
      }
    });
    machine.send({ add: 1 });
    expect(states).toEqual([1, 11]);
  });

  it('passes params to the step and notifies subscribers once per step until unsubscribed', () => {
    const stepSpy = vi.fn((state: number, event: Event, _params: { k: number }) => step(state, event));
    const machine = createMachine<number, Event, Effect, { k: number }>(
      (state, event, params) => stepSpy(state, event, params),
      0,
      { k: 7 },
      () => {},
    );
    const listener = vi.fn();
    const off = machine.subscribe(listener);
    machine.send({ add: 1 });
    expect(stepSpy).toHaveBeenCalledWith(0, { add: 1 }, { k: 7 });
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    machine.send({ add: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps working after an effect throws: the error surfaces, the queue is dropped', () => {
    let fail = true;
    const machine = createMachine<number, Event, Effect, null>(step, 0, null, (effect, send) => {
      if ('send' in effect) send(effect.send);
      if ('log' in effect && fail) throw new Error('boom');
    });
    expect(() => machine.send({ chain: [1] })).toThrow('boom');
    fail = false;
    machine.send({ add: 5 });
    expect(machine.getState()).toBe(5);
  });
});
