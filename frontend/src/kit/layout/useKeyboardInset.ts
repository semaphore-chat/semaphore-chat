import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  const viewport = typeof window === 'undefined' ? null : window.visualViewport;
  if (!viewport) {
    return () => undefined;
  }
  viewport.addEventListener('resize', onChange);
  viewport.addEventListener('scroll', onChange);
  return () => {
    viewport.removeEventListener('resize', onChange);
    viewport.removeEventListener('scroll', onChange);
  };
}

/**
 * The height, in CSS pixels, that the window's bottom part is covered by: the on-screen keyboard. It is
 * the gap between the bottom of the window and the bottom of the visual viewport. 0 where there is no visual
 * viewport, while the keyboard is down, and while the page is pinch-zoomed (which also shrinks the visual
 * viewport, but is not a keyboard).
 */
function read(): number {
  const viewport = typeof window === 'undefined' ? null : window.visualViewport;
  if (!viewport || viewport.scale > 1) {
    return 0;
  }
  return Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
}

/**
 * How much of the window's bottom the on-screen keyboard covers, in CSS pixels (0 when none, or when the
 * browser has no `visualViewport`). It follows the visual viewport's `resize` and `scroll` events and lets go of
 * them on unmount. `AppFrame` uses it to end the frame where the keyboard starts.
 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, read, () => 0);
}
