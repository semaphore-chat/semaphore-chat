/**
 * What the new shell does to the page while it is shown (design §4): it says it is shown (the old-look
 * global views yield, shell/shownShellKind.ts), takes `showNotification` into kit toasts, and paints the
 * browser's `theme-color` with its ground. All undone when it goes.
 *
 * Layout effects: from the commit that shows the shell, a notification already goes to a toast and the
 * old chrome is already gone, with no frame where both or neither show.
 */
import { useLayoutEffect } from 'react';
import { useKitPalette, useToasts, type ToastTone } from '../../../kit';
import { publishShownShellKind } from '../../shownShellKind';
import { registerNotificationSink, type NotificationSeverity } from '../../../contexts/notificationSink';
import { setThemeColorOverride } from '../../../hooks/useThemeColorMeta';

/** The kit's toast has three tones: a warning reads as a plain notice, an error as danger. */
const TONE: Record<NotificationSeverity, ToastTone> = {
  success: 'positive',
  info: 'neutral',
  warning: 'neutral',
  error: 'danger',
};

export function ShellEffects(): null {
  const toasts = useToasts();
  const { ground } = useKitPalette();

  useLayoutEffect(() => {
    publishShownShellKind('lounge');
    return () => publishShownShellKind('classic');
  }, []);

  useLayoutEffect(
    () => registerNotificationSink((message, severity) => toasts.show({ message, tone: TONE[severity] })),
    [toasts],
  );

  useLayoutEffect(() => {
    setThemeColorOverride(ground);
  }, [ground]);
  useLayoutEffect(() => () => setThemeColorOverride(null), []);

  return null;
}
