import { useEffect } from 'react';

/**
 * Keeps `<meta name="theme-color">` in sync with the active theme so the
 * browser/OS chrome (mobile status bar, PWA title bar) matches the app.
 *
 * Pass a solid colour (e.g. `theme.palette.background.paper`) — never a
 * gradient (`background.ground`) or `background.canvas` (may be transparent).
 * Creates the tag if the document doesn't have one.
 */
export function useThemeColorMeta(color: string): void {
  useEffect(() => {
    if (typeof document === 'undefined' || !color) return;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', color);
  }, [color]);
}
