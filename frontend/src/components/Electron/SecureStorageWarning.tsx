/**
 * Secure Storage Warning
 *
 * Surfaces tokenService's one-time "secure storage unavailable" warning via
 * the app's existing snackbar/notification mechanism (NotificationContext).
 * Renders nothing itself.
 *
 * Delivery has two paths:
 *  - Mount-time consumption: most real-world triggers (AuthGate's pre-mount
 *    silent refresh on cold launch, login/register/onboarding) fire BEFORE
 *    this component mounts, so on mount we check for a durable "pending"
 *    marker left behind by an earlier trigger and show the warning
 *    immediately if found — no further event required.
 *  - Live delivery: if a persist happens while this component is already
 *    mounted (e.g. a later periodic token refresh), the subscription below
 *    delivers it immediately.
 *
 * Mounted inside AuthGate's <NotificationProvider> so it's available
 * whenever the user is in the authenticated app shell.
 */

import { useEffect } from 'react';
import { useNotification } from '../../contexts/NotificationContext';
import { useElectronAPI } from '../../contexts/ElectronContext';
import {
  consumePendingSecureStorageWarning,
  onSecureStorageWarning,
} from '../../utils/tokenService';

const SECURE_STORAGE_WARNING_MESSAGE =
  'Secure credential storage is unavailable on this system; your session token will be stored unencrypted.';

export const SecureStorageWarning = () => {
  const { showNotification } = useNotification();
  // Null outside Electron.
  const isElectron = useElectronAPI() !== null;

  useEffect(() => {
    if (!isElectron) return;

    // Consume any warning that became pending before this component mounted.
    if (consumePendingSecureStorageWarning()) {
      showNotification(SECURE_STORAGE_WARNING_MESSAGE, 'warning');
    }

    return onSecureStorageWarning(() => {
      showNotification(SECURE_STORAGE_WARNING_MESSAGE, 'warning');
    });
  }, [isElectron, showNotification]);

  return null;
};
