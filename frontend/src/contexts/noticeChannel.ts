/**
 * The app's one transient notice (`showNotification`), shared by the two presenters (I1).
 *
 * NotificationProvider (AuthGate, above both shells) owns the notice: the latest one wins, as it always
 * did. It publishes the notice here. Whichever shell is shown presents it: the old shell's snackbar, or,
 * while the new design's shell is shown, a kit toast (frame/ShellEffects). A flip hands the notice that is
 * showing to the other presenter (its time restarts); it is put away only when it has been shown for its
 * time or dismissed, by either presenter. So no notice is lost or shown twice when the shells flip.
 *
 * Its own module, without MUI, so the new shell's chunk can read it without the snackbar.
 */
import { useSyncExternalStore } from 'react';

export type NotificationSeverity = 'success' | 'info' | 'warning' | 'error';

export interface Notice {
  /** Changes with every `showNotification`, even for the same text. */
  readonly key: number;
  readonly message: string;
  readonly severity: NotificationSeverity;
  /** Already read out by a presenter (the next one shows it without speaking it again, where it can). */
  readonly announced: boolean;
}

interface Owner {
  dismiss(key: number): void;
  markAnnounced(key: number): void;
}

let current: Notice | null = null;
let owner: Owner | null = null;
const listeners = new Set<() => void>();

/** NotificationProvider: the notice now (null when none shows) and how to put it away. */
export function publishNotice(notice: Notice | null, by: Owner | null): void {
  owner = by;
  if (notice === current) return;
  current = notice;
  listeners.forEach((listener) => listener());
}

/** A presenter: the notice has had its time, or the user dismissed it. Ignored if a newer one replaced it. */
export function dismissNotice(key: number): void {
  owner?.dismiss(key);
}

/** A presenter read the notice out (a kit toast announces itself). */
export function markNoticeAnnounced(key: number): void {
  owner?.markAnnounced(key);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readNotice(): Notice | null {
  return current;
}

/** The notice showing now, for the new shell's presenter. */
export function useNotice(): Notice | null {
  return useSyncExternalStore(subscribe, readNotice, () => null);
}
