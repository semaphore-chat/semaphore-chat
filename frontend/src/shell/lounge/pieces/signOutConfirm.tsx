/**
 * Sign out, asked first: the kit's confirm host over the app's one sign-out (`data/session`).
 *
 * The frame owns the question once (`SignOutConfirmHost`, above the width switch), and the controls that
 * offer Sign out… (the user card's account menu at compact and wide, the phone's "All communities" sheet)
 * only ask it to open (`useSignOutRequest`, `./signOutRequest`). So the question, and a sign-out that is running, survive the
 * window crossing the phone width, which swaps those controls. Signing out goes to the login page, which
 * takes the question with it.
 */
import type { JSX, ReactNode } from 'react';
import { useConfirmDestructive } from '../../../kit';
import { useSignOut } from '../../../data/session';
import { SIGN_OUT_DESCRIPTION, SIGN_OUT_LABEL, SIGN_OUT_TITLE } from './signOutText';
import { SignOutRequestContext } from './signOutRequest';

export interface SignOutQuestionHostProps {
  /** What confirming runs: the sign-out (`SignOutConfirmHost`); a story passes one that never settles. */
  run: () => Promise<void>;
  children: ReactNode;
}

/** The sign-out question, hosted once around `children`. */
export function SignOutQuestionHost({ run, children }: SignOutQuestionHostProps): JSX.Element {
  const { request, dialog } = useConfirmDestructive({
    title: SIGN_OUT_TITLE,
    description: SIGN_OUT_DESCRIPTION,
    confirmLabel: SIGN_OUT_LABEL,
    run: () => run(),
  });
  return (
    <SignOutRequestContext value={request}>
      {children}
      {dialog}
    </SignOutRequestContext>
  );
}

/** The frame's host: the question over the app's sign-out. */
export function SignOutConfirmHost({ children }: { children: ReactNode }): JSX.Element {
  const { signOut } = useSignOut();
  return <SignOutQuestionHost run={signOut}>{children}</SignOutQuestionHost>;
}

