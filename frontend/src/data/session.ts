/**
 * Signing out, for both shells: the app's one sign-out sequence (`hooks/useLogout` over
 * `utils/signOutSession`, the shared teardown): leave a call, end the session on the server (with a
 * timeout), always clear everything local, then go to the login page. Nothing here tears anything down
 * of its own.
 */
import { useLogout } from '../hooks/useLogout';

export interface SignOut {
  /** Runs the sign-out. While one runs, a second call returns the running one. Resolves after navigating. */
  signOut(): Promise<void>;
  /** A sign-out is running (any control's). */
  signingOut: boolean;
}

export function useSignOut(): SignOut {
  const { handleLogout, logoutLoading } = useLogout();
  return { signOut: () => handleLogout(), signingOut: logoutLoading };
}
