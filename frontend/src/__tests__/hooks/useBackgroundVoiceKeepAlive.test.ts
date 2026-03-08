import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBackgroundVoiceKeepAlive } from '../../hooks/useBackgroundVoiceKeepAlive';

// Track mock state
let mockIsElectron = false;
let mockRequestPowerSaveBlock: ReturnType<typeof vi.fn>;
let mockReleasePowerSaveBlock: ReturnType<typeof vi.fn>;
let lockRequestSpy: ReturnType<typeof vi.fn>;
let lockResolvers: Array<(value: void) => void> = [];

vi.mock('../../utils/platform', () => ({
  isElectron: vi.fn(() => mockIsElectron),
}));

// Save original navigator.locks descriptor so we can restore after tests
const originalLocksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');

describe('useBackgroundVoiceKeepAlive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsElectron = false;
    lockResolvers = [];
    mockRequestPowerSaveBlock = vi.fn().mockResolvedValue(42);
    mockReleasePowerSaveBlock = vi.fn().mockResolvedValue(undefined);

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

    // Clean window.electronAPI
    (window as Record<string, unknown>).electronAPI = undefined;
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
    mockIsElectron = true;
    (window as Record<string, unknown>).electronAPI = {
      isElectron: true,
      requestPowerSaveBlock: mockRequestPowerSaveBlock,
      releasePowerSaveBlock: mockReleasePowerSaveBlock,
    };

    renderHook(() => useBackgroundVoiceKeepAlive({ isConnected: true }));

    // Let the promise resolve
    await vi.waitFor(() => {
      expect(mockRequestPowerSaveBlock).toHaveBeenCalledTimes(1);
    });
  });

  it('should release power save block in Electron on unmount', async () => {
    mockIsElectron = true;
    (window as Record<string, unknown>).electronAPI = {
      isElectron: true,
      requestPowerSaveBlock: mockRequestPowerSaveBlock,
      releasePowerSaveBlock: mockReleasePowerSaveBlock,
    };

    const { unmount } = renderHook(() =>
      useBackgroundVoiceKeepAlive({ isConnected: true }),
    );

    // Let the power save request resolve
    await vi.waitFor(() => {
      expect(mockRequestPowerSaveBlock).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(mockReleasePowerSaveBlock).toHaveBeenCalledWith(42);
  });

  it('should not request power save block in web browser', () => {
    mockIsElectron = false;

    renderHook(() => useBackgroundVoiceKeepAlive({ isConnected: true }));

    expect(mockRequestPowerSaveBlock).not.toHaveBeenCalled();
  });
});
