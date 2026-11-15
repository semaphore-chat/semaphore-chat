import { describe, expect, it } from 'vitest';
import { createIds } from '../../../../kit/behaviour/hosts/ids';

describe('ids', () => {
  it('counts up per kind and never repeats', () => {
    const ids = createIds();
    expect(ids.next('layer')).toBe('layer-1');
    expect(ids.next('layer')).toBe('layer-2');
    expect(ids.next('toast')).toBe('toast-1');
  });

  it('two factories do not share a counter', () => {
    expect(createIds().next('layer')).toBe('layer-1');
    expect(createIds().next('layer')).toBe('layer-1');
  });

  it('gives an element the same opener id every time, and different elements different ids', () => {
    const ids = createIds();
    const a = document.createElement('button');
    const b = document.createElement('button');
    expect(ids.forElement(a)).toBe(ids.forElement(a));
    expect(ids.forElement(a)).not.toBe(ids.forElement(b));
    expect(ids.forElement(a)).toMatch(/^opener-/);
  });
});
