/**
 * Opening the frame's sign-out question (`signOutConfirm.tsx`) from a control that offers Sign out….
 * Its own module: a component module exports components only (Fast Refresh).
 */
import { createContext, useContext } from 'react';

export const SignOutRequestContext = createContext<(() => void) | null>(null);

/** Opens the sign-out question. Stable. Inside a `SignOutConfirmHost` (the frame) only. */
export function useSignOutRequest(): () => void {
  const request = useContext(SignOutRequestContext);
  if (request === null) throw new Error('useSignOutRequest needs a SignOutRequestContext provider above it (SignOutConfirmHost in the Lounge frame, or SignOutQuestionHost).');
  return request;
}
