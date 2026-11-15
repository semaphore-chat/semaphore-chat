import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

type PaneRefs = Record<string, RefObject<HTMLElement | null>>;

/**
 * Keeps keyboard and screen-reader focus from being lost when the pane that holds it stops being shown
 * (the phone shows another pane, the width crosses into the phone range, the right island goes away).
 * The browser would drop focus on `<body>`. Instead, when `shown` changes and the focus was last inside a pane
 * that is no longer in `shown`, the `target` pane takes it.
 *
 * `panes` maps a pane's id to its element (each must be focusable with `tabIndex={-1}`). Focus that was
 * elsewhere (an overlay, outside the layout) is left alone.
 */
export function useFollowFocus(panes: PaneRefs, shown: readonly string[], target: string): void {
  const latest = useRef(panes);
  latest.current = panes;
  const last = useRef<string | null>(null);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const hit = Object.entries(latest.current).find(([, ref]) => ref.current?.contains(event.target as Node));
      last.current = hit ? hit[0] : null;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const key = shown.join('|');
  useLayoutEffect(() => {
    const was = last.current;
    if (was === null || shown.includes(was)) {
      return;
    }
    const active = document.activeElement;
    const stranded = !active || active === document.body || Boolean(latest.current[was]?.current?.contains(active));
    if (stranded) {
      latest.current[target]?.current?.focus();
    } else {
      last.current = null;
    }
    // `shown` is read through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, target]);
}
