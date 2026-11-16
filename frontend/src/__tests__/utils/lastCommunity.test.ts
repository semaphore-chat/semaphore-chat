import { describe, it, expect, afterEach, vi } from 'vitest';
import { forgetLastCommunity, readLastCommunity, rememberLastCommunity, LAST_COMMUNITY_KEY } from '../../utils/lastCommunity';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('lastCommunity', () => {
  it('remembers and reads the id', () => {
    rememberLastCommunity('c-1');
    expect(readLastCommunity()).toBe('c-1');
  });

  it('forgetLastCommunity removes it', () => {
    rememberLastCommunity('c-1');
    forgetLastCommunity();
    expect(localStorage.getItem(LAST_COMMUNITY_KEY)).toBeNull();
    expect(readLastCommunity()).toBeNull();
  });

  it('tolerates storage that throws', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => forgetLastCommunity()).not.toThrow();
  });
});
