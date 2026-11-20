import { useEffect } from 'react';

/** The colour the old shell's theme asks for (the last one `useThemeColorMeta` saw). */
let themeColor: string | null = null;
/** Set while the new design's shell is shown: it wins over the old theme's colour. */
let override: string | null = null;

function writeThemeColor(color: string): void {
  if (typeof document === 'undefined') return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
}

/**
 * Keeps `<meta name="theme-color">` in sync with the active theme so the
 * browser/OS chrome (mobile status bar, PWA title bar) matches the app.
 *
 * Pass a solid colour (e.g. `theme.palette.background.paper`) — never a
 * gradient (`background.ground`) or `background.canvas` (may be transparent).
 * Creates the tag if the document doesn't have one.
 *
 * While `setThemeColorOverride` holds a colour, that colour stays on the tag and a
 * change of this one is only remembered for when the override is lifted.
 */
export function useThemeColorMeta(color: string): void {
  useEffect(() => {
    if (typeof document === 'undefined' || !color) return;
    themeColor = color;
    if (override === null) writeThemeColor(color);
  }, [color]);
}

/**
 * The new design's shell sets its ground colour here while it is shown and `null` when it goes:
 * the old theme's colour (which keeps following the old palette meanwhile) comes back.
 */
export function setThemeColorOverride(color: string | null): void {
  override = color;
  const next = override ?? themeColor;
  if (next) writeThemeColor(next);
}
