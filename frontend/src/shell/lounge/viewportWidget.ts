/**
 * While the new shell is mounted, the page's viewport meta asks for `interactive-widget=resizes-content`: on
 * Android the on-screen keyboard then shrinks the layout viewport, so the composer stays above it (iOS already
 * reports the keyboard through `visualViewport`). The meta's exact earlier content comes back when the shell goes
 * away (the old shell is unchanged). Each mount reads the content once and restores it once, so React's strict
 * mode (mount, unmount, mount) ends with the setting on and a later unmount restores the original.
 */
import { useEffect } from 'react';

const SETTING = 'interactive-widget=resizes-content';

/** `content` with `interactive-widget` set to `resizes-content` (any other value of it replaced). */
export function withResizesContent(content: string): string {
  const parts = content
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !/^interactive-widget\s*=/i.test(part));
  return [...parts, SETTING].join(', ');
}

export function useInteractiveWidgetResizesContent(): void {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (meta === null) return;
    const previous = meta.getAttribute('content');
    meta.setAttribute('content', withResizesContent(previous ?? ''));
    return () => {
      if (previous === null) meta.removeAttribute('content');
      else meta.setAttribute('content', previous);
    };
  }, []);
}
