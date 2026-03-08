import { useEffect, useRef } from 'react';
import { isElectron } from '../utils/platform';

interface UseBackgroundVoiceKeepAliveParams {
  isConnected: boolean;
}

/**
 * Prevents the browser/OS from suspending the tab or app while
 * the user is connected to a voice channel.
 *
 * - **Web**: Acquires a Web Lock (`navigator.locks`) which tells Chrome
 *   not to freeze/discard the tab.
 * - **Electron**: Requests a `powerSaveBlocker` via IPC to prevent
 *   OS-level suspension during calls.
 */
export function useBackgroundVoiceKeepAlive({ isConnected }: UseBackgroundVoiceKeepAliveParams) {
  const lockReleaseRef = useRef<(() => void) | null>(null);
  const powerSaveIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isConnected) return;

    // --- Web Lock ---
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      try {
        const controller = new AbortController();

        navigator.locks.request(
          'semaphore-voice-active',
          { signal: controller.signal },
          () => new Promise<void>((resolve) => {
            // Store the resolve function — calling it releases the lock
            lockReleaseRef.current = resolve;
          }),
        ).catch(() => {
          // AbortError is expected when we release via controller.abort()
        });

        // Store abort as an alternative release mechanism
        const prevRelease = lockReleaseRef.current;
        lockReleaseRef.current = () => {
          prevRelease?.();
          controller.abort();
        };
      } catch {
        // Web Locks API not available — not critical
      }
    }

    // --- Electron power save blocker ---
    let cleanedUp = false;
    if (isElectron() && window.electronAPI?.requestPowerSaveBlock) {
      window.electronAPI.requestPowerSaveBlock().then((id) => {
        if (typeof id === 'number') {
          if (cleanedUp) {
            // Cleanup already ran — release immediately to avoid leaking the blocker
            window.electronAPI?.releasePowerSaveBlock?.(id)?.catch(() => {});
          } else {
            powerSaveIdRef.current = id;
          }
        }
      }).catch(() => {
        // Power save block not available — not critical
      });
    }

    return () => {
      cleanedUp = true;

      // Release Web Lock
      if (lockReleaseRef.current) {
        lockReleaseRef.current();
        lockReleaseRef.current = null;
      }

      // Release Electron power save blocker
      if (powerSaveIdRef.current !== null && window.electronAPI?.releasePowerSaveBlock) {
        window.electronAPI.releasePowerSaveBlock(powerSaveIdRef.current).catch(() => {});
        powerSaveIdRef.current = null;
      }
    };
  }, [isConnected]);
}
