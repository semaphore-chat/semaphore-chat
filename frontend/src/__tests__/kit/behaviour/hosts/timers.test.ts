import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserTimers, createTimerService } from '../../../../kit/behaviour/hosts/timers';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('timer service', () => {
  it('fires after the delay, once', () => {
    const fire = vi.fn();
    browserTimers.start({}, 1, 1000, fire);
    vi.advanceTimersByTime(999);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(5000);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('never delivers a cancelled timer', () => {
    const owner = {};
    const fire = vi.fn();
    browserTimers.start(owner, 1, 1000, fire);
    browserTimers.cancel(owner, 1);
    vi.advanceTimersByTime(5000);
    expect(fire).not.toHaveBeenCalled();
  });

  it('keys timers by owner: the same token on two owners is two timers', () => {
    const a = {};
    const b = {};
    const fireA = vi.fn();
    const fireB = vi.fn();
    browserTimers.start(a, 1, 1000, fireA);
    browserTimers.start(b, 1, 2000, fireB);
    browserTimers.cancel(a, 1);
    vi.advanceTimersByTime(2000);
    expect(fireA).not.toHaveBeenCalled();
    expect(fireB).toHaveBeenCalledTimes(1);
  });

  it('starting the same owner and token again replaces the first', () => {
    const owner = {};
    const first = vi.fn();
    const second = vi.fn();
    browserTimers.start(owner, 1, 1000, first);
    browserTimers.start(owner, 1, 3000, second);
    vi.advanceTimersByTime(3000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancelling an unknown or already fired timer does nothing', () => {
    const owner = {};
    const fire = vi.fn();
    browserTimers.cancel(owner, 9);
    browserTimers.start(owner, 1, 10, fire);
    vi.advanceTimersByTime(10);
    browserTimers.cancel(owner, 1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('disposeAll cancels every timer of one owner and leaves others', () => {
    const a = {};
    const b = {};
    const fireA1 = vi.fn();
    const fireA2 = vi.fn();
    const fireB = vi.fn();
    browserTimers.start(a, 1, 10, fireA1);
    browserTimers.start(a, 2, 10, fireA2);
    browserTimers.start(b, 1, 10, fireB);
    browserTimers.disposeAll(a);
    vi.advanceTimersByTime(10);
    expect(fireA1).not.toHaveBeenCalled();
    expect(fireA2).not.toHaveBeenCalled();
    expect(fireB).toHaveBeenCalledTimes(1);
  });

  it('a stale callback from a scheduler that cannot cancel is still never delivered', () => {
    // A scheduler whose clear is a no-op: the callback runs anyway after cancel.
    const pending: Array<() => void> = [];
    const service = createTimerService({
      set: (callback) => {
        pending.push(callback);
        return pending.length;
      },
      clear: () => {},
    });
    const owner = {};
    const fire = vi.fn();
    service.start(owner, 1, 10, fire);
    service.cancel(owner, 1);
    pending.forEach((callback) => callback());
    expect(fire).not.toHaveBeenCalled();

    const replaced = vi.fn();
    service.start(owner, 2, 10, fire);
    service.start(owner, 2, 10, replaced);
    pending.splice(0).forEach((callback) => callback());
    expect(fire).not.toHaveBeenCalled();
    expect(replaced).toHaveBeenCalledTimes(1);
  });
});
