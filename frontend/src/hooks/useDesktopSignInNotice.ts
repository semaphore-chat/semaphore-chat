import { ServerEvents } from '@semaphore-chat/shared';
import { useNotification } from '../contexts/NotificationContext';
import { useServerEvent } from '../socket-hub/useServerEvent';

/**
 * Tells this session when a desktop app signs in to the account through a
 * browser approval, so an approval the user didn't make doesn't go unnoticed.
 */
export const useDesktopSignInNotice = () => {
  const { showNotification } = useNotification();

  useServerEvent(ServerEvents.DESKTOP_SIGN_IN, () => {
    showNotification(
      "A desktop app just signed in to your account. If this wasn't you, change your password.",
      'warning',
    );
  });
};
