import { describe, expect, it } from 'vitest';
import { createBoundedSet } from '../../../shell/lounge/screens/chat/boundedSet';

describe('createBoundedSet', () => {
  it('drops the oldest entry once past the limit and keeps the rest', () => {
    const set = createBoundedSet<string>(200);
    for (let i = 0; i < 201; i += 1) set.add(`u${i}`);
    expect(set.size).toBe(200);
    expect(set.has('u0')).toBe(false);
    for (let i = 1; i < 201; i += 1) expect(set.has(`u${i}`)).toBe(true);
  });

  it('counts a repeated entry once and makes it the newest', () => {
    const set = createBoundedSet<string>(2);
    set.add('a');
    set.add('b');
    set.add('a');
    set.add('c');
    expect(set.has('b')).toBe(false);
    expect(set.has('a')).toBe(true);
    expect(set.has('c')).toBe(true);
  });
});
