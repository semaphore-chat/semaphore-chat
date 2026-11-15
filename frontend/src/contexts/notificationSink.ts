/**
 * Where `showNotification` (NotificationContext) delivers while the new design's shell is shown.
 *
 * The old snackbar is MUI and old-look; while the new shell is on screen it registers a sink that
 * turns each notification into a kit toast, and the snackbar shows nothing. With no sink registered
 * (the old shell, or the new design off) `showNotification` opens the snackbar exactly as before.
 *
 * Its own module, without MUI, so the new shell's chunk can import it without the snackbar.
 */
export type NotificationSeverity = 'success' | 'info' | 'warning' | 'error';

export type NotificationSink = (message: string, severity: NotificationSeverity) => void;

let sink: NotificationSink | null = null;

/** Registers the sink; returns the function that removes it again (only if it is still the one). */
export function registerNotificationSink(next: NotificationSink): () => void {
  sink = next;
  return () => {
    if (sink === next) sink = null;
  };
}

/** The registered sink, or null when notifications go to the old snackbar. */
export function currentNotificationSink(): NotificationSink | null {
  return sink;
}
