import { describe, expect, it } from 'vitest';
import { behaviourVectors } from '../../../kit/behaviour/generated/vectors';
import {
  DEFAULT_PARAMS,
  initialToastQueue,
  stepToastQueue,
} from '../../../kit/behaviour/toastQueue';
import type { Event, State } from '../../../kit/behaviour/toastQueue';
import { deepFreeze } from './deepFreeze';

const { initial, params, vectors } = behaviourVectors.toastQueue;
const stepCount = vectors.reduce((total, vector) => total + vector.steps.length, 0);

describe('toastQueue', () => {
  it(`reproduces every generated vector (${vectors.length} vectors, ${stepCount} steps)`, () => {
    for (const vector of vectors) {
      // Frozen before every step: a reducer that mutates its input throws here.
      let state = deepFreeze(vector.initial as unknown as State);
      vector.steps.forEach((step, index) => {
        // The vectors are `as const`, so their events are readonly; the reducer takes its own types.
        const event = step.event as unknown as Event;
        const result = stepToastQueue(state, event, vector.params);
        expect(result.state, `${vector.name}: step ${index} state`).toEqual(step.state);
        expect(result.effects, `${vector.name}: step ${index} effects`).toEqual(step.effects);
        state = deepFreeze(result.state);
      });
    }
  });

  it('defaults to the generated params and initial state', () => {
    expect(DEFAULT_PARAMS).toEqual(params);
    expect(initialToastQueue()).toEqual(initial);
  });

  it('rejects an event it does not declare', () => {
    const explode = { explode: {} } as unknown as Event;
    expect(() => stepToastQueue(initialToastQueue(), explode)).toThrow(RangeError);
    expect(() => stepToastQueue(initialToastQueue(), explode)).toThrow(/\bexplode\b/);
  });
});
