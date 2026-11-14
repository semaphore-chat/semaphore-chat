import { ProcessSlots } from './process-slots.util';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ProcessSlots', () => {
  afterEach(() => jest.useRealTimers());

  it('runs at most `size` tasks at once and starts the next as one ends', async () => {
    const slots = new ProcessSlots(2, 10_000);
    const tasks = [deferred(), deferred(), deferred()];
    const started: number[] = [];

    const runs = tasks.map((task, index) =>
      slots.run(() => {
        started.push(index);
        return task.promise;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);

    tasks[1].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);

    tasks[0].resolve();
    tasks[2].resolve();
    await Promise.all(runs);
  });

  it('frees the slot when a task rejects', async () => {
    const slots = new ProcessSlots(1, 10_000);
    await expect(
      slots.run(() => Promise.reject(new Error('ffmpeg failed'))),
    ).rejects.toThrow('ffmpeg failed');

    await expect(slots.run(() => Promise.resolve('next'))).resolves.toBe(
      'next',
    );
  });

  it('rejects a waiting task after the wait limit without running it', async () => {
    jest.useFakeTimers();
    const slots = new ProcessSlots(1, 10_000);
    const first = deferred();
    const running = slots.run(() => first.promise);
    const task = jest.fn(() => Promise.resolve());

    const waiting = slots.run(task);
    const assertion = expect(waiting).rejects.toThrow(
      'No free media slot after 10000 ms',
    );
    await jest.advanceTimersByTimeAsync(10_001);
    await assertion;
    expect(task).not.toHaveBeenCalled();

    // The timed-out waiter left the queue: the slot frees normally
    first.resolve();
    await running;
    await expect(slots.run(() => Promise.resolve(1))).resolves.toBe(1);
  });
});
