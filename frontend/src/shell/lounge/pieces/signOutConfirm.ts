/**
 * Sign out, asked first: the kit's confirm host over the app's one sign-out (`data/session`). Used by the
 * user card's account menu and the phone's "All communities" sheet. `request` opens the dialog; render
 * `dialog` once in the tree of the control that opened it, so focus goes back to that control on Cancel.
 * Signing out goes to the login page, which takes the dialog with it.
 */
import { useConfirmDestructive, type ConfirmDestructive } from '../../../kit';
import { useSignOut } from '../../../data/session';
import { SIGN_OUT_DESCRIPTION, SIGN_OUT_LABEL, SIGN_OUT_TITLE } from './signOutText';

export function useSignOutConfirm(): Pick<ConfirmDestructive, 'request' | 'dialog'> {
  const { signOut } = useSignOut();
  const { request, dialog } = useConfirmDestructive({
    title: SIGN_OUT_TITLE,
    description: SIGN_OUT_DESCRIPTION,
    confirmLabel: SIGN_OUT_LABEL,
    run: () => signOut(),
  });
  return { request, dialog };
}
