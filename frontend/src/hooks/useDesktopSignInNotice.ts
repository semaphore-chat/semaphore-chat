import { ServerEvents } from '@semaphore-chat/shared';
import { useNotification } from '../contexts/NotificationContext';
import { useServerEvent } from '../socket-hub/useServerEvent';
import { readShownShellKind } from '../shell/shownShellKind';
import { DESKTOP_SIGN_IN_MESSAGE, showDesktopSignInNotice } from '../data/signInNotice';

/**
 * Tells this session when a desktop app signs in to the account through a
 * browser approval, so an approval the user didn't make doesn't go unnoticed.
 * The old shell shows it in its snackbar; while the new design's shell is
 * shown it is a banner there (data/signInNotice.ts) that stays until dismissed.
 */
export const useDesktopSignInNotice = () => {
  const { showNotification } = useNotification();

  useServerEvent(ServerEvents.DESKTOP_SIGN_IN, () => {
    if (readShownShellKind() === 'lounge') {
      showDesktopSignInNotice();
      return;
    }
    showNotification(DESKTOP_SIGN_IN_MESSAGE, 'warning');
  });
};
