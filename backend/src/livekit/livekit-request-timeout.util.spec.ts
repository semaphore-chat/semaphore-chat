import {
  LIVEKIT_REQUEST_TIMEOUT_MS,
  LivekitTimeoutError,
  withTimeout,
} from './livekit-request-timeout.util';

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the underlying value and clears its timer', async () => {
    jest.useFakeTimers();

    await expect(withTimeout(Promise.resolve('ok'), 'label')).resolves.toBe(
      'ok',
    );

    // Nothing left pending on the event loop once the call settled
    expect(jest.getTimerCount()).toBe(0);
  });

  it('propagates the underlying rejection and clears its timer', async () => {
    jest.useFakeTimers();

    await expect(
      withTimeout(Promise.reject(new Error('boom')), 'label'),
    ).rejects.toThrow('boom');

    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with a clear LivekitTimeoutError when the call never settles', async () => {
    jest.useFakeTimers();

    const neverSettles = new Promise<string>(() => {});
    const result = withTimeout(
      neverSettles,
      'removeParticipant room-1/user-1',
    ).catch((error: unknown) => error);

    jest.advanceTimersByTime(LIVEKIT_REQUEST_TIMEOUT_MS);

    const error = await result;
    expect(error).toBeInstanceOf(LivekitTimeoutError);
    expect((error as Error).message).toBe(
      'LiveKit request timed out after 5000ms: removeParticipant room-1/user-1',
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('honours a custom timeout', async () => {
    jest.useFakeTimers();

    const neverSettles = new Promise<string>(() => {});
    const result = withTimeout(neverSettles, 'listRooms', 250).catch(
      (error: unknown) => error,
    );

    jest.advanceTimersByTime(249);
    // Not yet: the promise is still racing
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    jest.advanceTimersByTime(1);
    expect(((await result) as Error).message).toBe(
      'LiveKit request timed out after 250ms: listRooms',
    );
  });
});
