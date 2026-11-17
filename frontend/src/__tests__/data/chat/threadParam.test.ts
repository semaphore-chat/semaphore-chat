import { describe, expect, it } from 'vitest';
import { readThreadParam, searchWith } from '../../../data/chat/threadParam';

describe('the ?thread= param', () => {
  it('reads an id; anything that is not one is no thread', () => {
    expect(readThreadParam(new URLSearchParams('thread=8f0c-11aa'))).toBe('8f0c-11aa');
    expect(readThreadParam(new URLSearchParams('highlight=m1'))).toBeNull();
    expect(readThreadParam(new URLSearchParams('thread='))).toBeNull();
    expect(readThreadParam(new URLSearchParams('thread=a%2Fb'))).toBeNull();
    expect(readThreadParam(new URLSearchParams(`thread=${'a'.repeat(65)}`))).toBeNull();
  });

  it('sets or drops one param and keeps the others', () => {
    const params = new URLSearchParams('highlight=m1&thread=p1');
    expect(searchWith(params, 'highlight', null)).toBe('?thread=p1');
    expect(searchWith(params, 'thread', 'p2')).toBe('?highlight=m1&thread=p2');
    expect(searchWith(new URLSearchParams('thread=p1'), 'thread', null)).toBe('');
  });
});
