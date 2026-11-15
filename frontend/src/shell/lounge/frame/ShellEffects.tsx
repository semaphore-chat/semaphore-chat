/**
 * What the new shell does to the page while it is shown (design §4): it says it is shown (the old-look
 * global views yield, shell/shownShellKind.ts), presents the app's transient notice as a kit toast
 * (contexts/noticeChannel.ts), and paints the browser's `theme-color` with its ground. All undone when it
 * goes; a notice still showing then goes back to the old shell's snackbar.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useKitPalette, useToasts, type ToastTone } from '../../../kit';
import { publishShownShellKind } from '../../shownShellKind';
import {
  dismissNotice,
  markNoticeAnnounced,
  useNotice,
  type NotificationSeverity,
} from '../../../contexts/noticeChannel';
import { setThemeColorOverride } from '../../../hooks/useThemeColorMeta';

/** The kit's toast has three tones: a warning reads as a plain notice, an error as danger. */
const TONE: Record<NotificationSeverity, ToastTone> = {
  success: 'positive',
  info: 'neutral',
  warning: 'neutral',
  error: 'danger',
};

/** How long a notice counts as shown here: the old snackbar's time, so a flip mid-way hands it on. */
export const NOTICE_SHOWN_MS = 3000;

/** The app's notice as a kit toast. Same text and severity: one toast (the latest wins, as in the old snackbar). */
function useNoticePresenter(): void {
  const toasts = useToasts();
  const notice = useNotice();
  const latest = useRef(notice);
  latest.current = notice;
  const key = notice?.key ?? null;
  useEffect(() => {
    const shown = latest.current;
    if (shown === null) return undefined;
    const id = `notice:${shown.severity}:${shown.message}`;
    toasts.show({ id, message: shown.message, tone: TONE[shown.severity] });
    markNoticeAnnounced(shown.key);
    const timer = setTimeout(() => dismissNotice(shown.key), NOTICE_SHOWN_MS);
    return () => {
      clearTimeout(timer);
      toasts.dismiss(id);
    };
  }, [key, toasts]);
}

export function ShellEffects(): null {
  const { ground } = useKitPalette();

  useLayoutEffect(() => {
    publishShownShellKind('lounge');
    return () => publishShownShellKind('classic');
  }, []);

  useNoticePresenter();

  useLayoutEffect(() => {
    setThemeColorOverride(ground);
  }, [ground]);
  useLayoutEffect(() => () => setThemeColorOverride(null), []);

  return null;
}
