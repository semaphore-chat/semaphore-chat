import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLastChannelId, pickInitialChannel, setLastChannelId } from '../../utils/lastChannel';
import { createChannel } from '../test-utils';
import type { Channel } from '../../types/channel.type';

const ch = (id: string, type: 'TEXT' | 'VOICE', position: number) =>
  createChannel({ id, type, position, name: id }) as unknown as Channel;

describe('last-visited channel storage', () => {
  beforeEach(() => localStorage.clear());

  it('stores per user and community', () => {
    setLastChannelId('u1', 'c1', 'a');
    setLastChannelId('u2', 'c1', 'b');
    setLastChannelId('u1', 'c2', 'c');
    expect(getLastChannelId('u1', 'c1')).toBe('a');
    expect(getLastChannelId('u2', 'c1')).toBe('b');
    expect(getLastChannelId('u1', 'c2')).toBe('c');
    expect(getLastChannelId('u3', 'c1')).toBeNull();
  });

  it('does nothing without a user', () => {
    setLastChannelId(undefined, 'c1', 'a');
    expect(getLastChannelId(undefined, 'c1')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('survives blocked storage', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => setLastChannelId('u1', 'c1', 'a')).not.toThrow();
    expect(getLastChannelId('u1', 'c1')).toBeNull();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('pickInitialChannel', () => {
  const channels = [ch('v', 'VOICE', 0), ch('t2', 'TEXT', 2), ch('t1', 'TEXT', 1)];

  it('prefers the remembered text channel', () => {
    expect(pickInitialChannel(channels, 't2')?.id).toBe('t2');
  });

  it('falls back to the first text channel by position', () => {
    expect(pickInitialChannel(channels, null)?.id).toBe('t1');
  });

  it('ignores a remembered channel that is gone or not visible', () => {
    expect(pickInitialChannel(channels, 'deleted')?.id).toBe('t1');
  });

  it('never picks a voice channel', () => {
    expect(pickInitialChannel(channels, 'v')?.id).toBe('t1');
    expect(pickInitialChannel([ch('v', 'VOICE', 0)], null)).toBeNull();
  });

  it('is null when there are no channels', () => {
    expect(pickInitialChannel([], null)).toBeNull();
    expect(pickInitialChannel(undefined, null)).toBeNull();
  });
});
