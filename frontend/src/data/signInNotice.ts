/**
 * "A desktop app just signed in to your account": the notice while the new design's shell is
 * shown, where it is a banner that stays until dismissed. Headless.
 *
 * useDesktopSignInNotice (AppShell, above both shells) hears the server event once and decides:
 * the old shell gets its snackbar as before; the new shell gets this notice.
 */
import { useSyncExternalStore } from 'react';

export const DESKTOP_SIGN_IN_MESSAGE =
  "A desktop app just signed in to your account. If this wasn't you, change your password.";

let pending = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === pending) return;
  pending = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows the notice (a second sign-in while it shows keeps the one notice). */
export function showDesktopSignInNotice(): void {
  set(true);
}

export function dismissDesktopSignInNotice(): void {
  set(false);
}

/** The notice while it shows, with its dismiss; null otherwise. */
export function useDesktopSignInBanner(): { message: string; dismiss(): void } | null {
  const shown = useSyncExternalStore(subscribe, () => pending, () => false);
  return shown ? { message: DESKTOP_SIGN_IN_MESSAGE, dismiss: dismissDesktopSignInNotice } : null;
}
