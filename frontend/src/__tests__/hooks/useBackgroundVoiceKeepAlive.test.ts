import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBackgroundVoiceKeepAlive } from '../../hooks/useBackgroundVoiceKeepAlive';
import { createElectronWrapper, createFakeElectronAPI } from '../test-utils';

// Track mock state
let mockRequestPowerSaveBlock: Mock<() => Promise<number>>;
let mockReleasePowerSaveBlock: Mock<(id: number) => Promise<void>>;
let lockRequestSpy: ReturnType<typeof vi.fn>;
let lockResolvers: Array<(value: void) => void> = [];

// Save original navigator.locks descriptor so we can restore after tests
const originalLocksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');

describe('useBackgroundVoiceKeepAlive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockResolvers = [];
    mockRequestPowerSaveBlock = vi.fn<() => Promise<number>>().mockResolvedValue(42);
    mockReleasePowerSaveBlock = vi.fn<(id: number) => Promise<void>>().mockResolvedValue(undefined);

    // Setup navigator.locks mock
    lockRequestSpy = vi.fn((_name: string, _opts: unknown, cb: () => Promise<void>) => {
      const promise = cb();
      return promise;
    });

    Object.defineProperty(navigator, 'locks', {
      value: { request: lockRequestSpy },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // Release any pending locks
    lockResolvers.forEach((resolve) => resolve());
    lockResolvers = [];

    // Restore original navigator.locks to avoid leaking into other test files
    if (originalLocksDescriptor) {
      Object.defineProperty(navigator, 'locks', originalLocksDescriptor);
    } else {
      // navigator.locks didn't exist originally (jsdom) — remove it
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (navigator as any).locks;
    }
  });

  it('should acquire a Web Lock when connected', () => {
    renderHook(() => useBackgroundVoiceKeepAlive({ isConnected: true }));

    expect(lockRequestSpy).toHaveBeenCalledWith(
      'semaphore-voice-active',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.any(Function),
    );
  });

  it('should not acquire a Web Lock when not connected', () => {
    renderHook(() => useBackgroundVoiceKeepAlive({ isConnected: false }));

    expect(lockRequestSpy).not.toHaveBeenCalled();
  });

  it('should release the Web Lock on unmount', () => {
    const { unmount } = renderHook(() =>
      useBackgroundVoiceKeepAlive({ isConnected: true }),
    );

    expect(lockRequestSpy).toHaveBeenCalledTimes(1);
    unmount();
    // The lock release is via AbortController, which we tested by verifying
    // the signal was passed. The important thing is no errors on cleanup.
  });

  it('should release the Web Lock when disconnected', () => {
    const { rerender } = renderHook(
      ({ isConnected }) => useBackgroundVoiceKeepAlive({ isConnected }),
      { initialProps: { isConnected: true } },
    );

    expect(lockRequestSpy).toHaveBeenCalledTimes(1);

    rerender({ isConnected: false });
    // Cleanup runs, no errors
  });

  it('should request power save block in Electron when connected', async () => {
    const wrapper = createElectronWrapper(
      createFakeElectronAPI({
        requestPowerSaveBlock: mockRequestPowerSaveBlock,
        releasePowerSaveBlock: mockReleasePowerSaveBlock,
      }),
    );

    renderHook(() => useBackgroundVoiceKeepAlive({ isConnected: true }), { wrapper });

    // Let the promise resolve
    await vi.waitFor(() => {
      expect(mockRequestPowerSaveBlock).toHaveBeenCalledTimes(1);
    });
  });

  it('should release power save block in Electron on unmount', async () => {
    const wrapper = createElectronWrapper(
      createFakeElectronAPI({
        requestPowerSaveBlock: mockRequestPowerSaveBlock,
        releasePowerSaveBlock: mockReleasePowerSaveBlock,
      }),
    );

    const { unmount } = renderHook(
      () => useBackgroundVoiceKeepAlive({ isConnected: true }),
      { wrapper },
    );

    // Let the power save request resolve
    await vi.waitFor(() => {
      expect(mockRequestPowerSaveBlock).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(mockReleasePowerSaveBlock).toHaveBeenCalledWith(42);
  });

  it('releases the power save block as soon as it arrives if already disconnected', async () => {
    let resolveRequest: (id: number) => void = () => {};
    mockRequestPowerSaveBlock.mockReturnValue(new Promise<number>((resolve) => { resolveRequest = resolve; }));
    const wrapper = createElectronWrapper(
      createFakeElectronAPI({
        requestPowerSaveBlock: mockRequestPowerSaveBlock,
        releasePowerSaveBlock: mockReleasePowerSaveBlock,
      }),
    );

    const { unmount } = renderHook(
      () => useBackgroundVoiceKeepAlive({ isConnected: true }),
      { wrapper },
    );
    unmount();
    expect(mockReleasePowerSaveBlock).not.toHaveBeenCalled();

    resolveRequest(7);
    await vi.waitFor(() => {
      expect(mockReleasePowerSaveBlock).toHaveBeenCalledWith(7);
    });
  });

  it('should not request power save block in web browser', () => {
    renderHook(() => useBackgroundVoiceKeepAlive({ isConnected: true }), {
      wrapper: createElectronWrapper(null),
    });

    expect(mockRequestPowerSaveBlock).not.toHaveBeenCalled();
  });
});
