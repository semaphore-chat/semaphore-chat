/**
 * The browser-app notices both shells show: the network gone, a new web version waiting, the offer to
 * install the app. Headless. The old shell draws them with AppChrome's MUI strips and snackbars; the new
 * shell draws them as kit banners (ShellBanners).
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { applyUpdate, shouldShowUpdate, subscribeSwUpdate } from '../utils/swUpdate';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** False while the browser reports no network (`navigator.onLine`). */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
    () => true,
  );
}

export interface WebUpdate {
  /** Applies the waiting service worker (the page reloads). A second press while it runs does nothing. */
  reload(): void;
  reloading: boolean;
}

/**
 * The new web version waiting to be applied, or null. Null too while the update is deferred (during a
 * call: swUpdate.setUpdateDeferred), so a reload never ends a call.
 */
export function useWebUpdate(): WebUpdate | null {
  const show = useSyncExternalStore(subscribeSwUpdate, shouldShowUpdate, () => false);
  const [reloading, setReloading] = useState(false);
  const reload = useCallback(() => {
    if (reloading) return;
    setReloading(true);
    // A rejection (no service worker wired) lets the user try again.
    void applyUpdate().catch(() => setReloading(false));
  }, [reloading]);
  return show ? { reload, reloading } : null;
}

export interface InstallOffer {
  /** iOS has no install prompt: the offer carries the manual steps instead of an Install action. */
  ios: boolean;
  /** The browser's install prompt; an accepted install also puts the offer away. */
  install(): Promise<void>;
  installing: boolean;
  /** Not now: away for 7 days. */
  dismiss(): void;
}

/** The offer to install the app (phones, not installed, not dismissed lately), or null. */
export function useInstallOffer(): InstallOffer | null {
  const { isInstallable, isIOS, install, dismiss } = useInstallPrompt();
  const [installing, setInstalling] = useState(false);
  const run = useCallback(async () => {
    setInstalling(true);
    try {
      if (await install()) dismiss();
    } finally {
      setInstalling(false);
    }
  }, [install, dismiss]);
  return isInstallable ? { ios: isIOS, install: run, installing, dismiss } : null;
}
