import { useEffect } from 'react';
import { ServerEvents } from '@semaphore-chat/shared';
import { useNotification } from '../contexts/NotificationContext';
import { useServerEvent } from '../socket-hub/useServerEvent';
import { readShownShellKind, useShownShellKind } from '../shell/shownShellKind';
import {
  DESKTOP_SIGN_IN_MESSAGE,
  dismissDesktopSignInNotice,
  showDesktopSignInNotice,
  useDesktopSignInBanner,
} from '../data/signInNotice';

/**
 * Tells this session when a desktop app signs in to the account through a
 * browser approval, so an approval the user didn't make doesn't go unnoticed.
 * The old shell shows it in its snackbar; while the new design's shell is
 * shown it is a banner there (data/signInNotice.ts) that stays until dismissed.
 * A banner still pending when the old shell comes back is shown in the
 * snackbar then, so the notice is seen in whichever shell is on screen.
 */
export const useDesktopSignInNotice = () => {
  const { showNotification } = useNotification();
  const classic = useShownShellKind() === 'classic';
  const pending = useDesktopSignInBanner() !== null;

  useServerEvent(ServerEvents.DESKTOP_SIGN_IN, () => {
    if (readShownShellKind() === 'lounge') {
      showDesktopSignInNotice();
      return;
    }
    showNotification(DESKTOP_SIGN_IN_MESSAGE, 'warning');
  });

  useEffect(() => {
    if (!classic || !pending) return;
    dismissDesktopSignInNotice();
    showNotification(DESKTOP_SIGN_IN_MESSAGE, 'warning');
  }, [classic, pending, showNotification]);
};
