/**
 * Focus and a screen-reader announcement on navigation between Lounge screens and on entry from the
 * old shell (design §4, M9).
 *
 * On a new path:
 * 1. On entry (this frame just mounted), the row remembered for the path (routeMemory) takes focus.
 * 2. Otherwise, if focus is in an open dialog or sheet, or still on an element inside a shown `nav` of
 *    the frame (the dock or the left island: the user is moving through a list), it stays; over a dialog
 *    nothing is announced either.
 * 3. Otherwise focus goes to the shown main's `h1` (made focusable with tabindex -1, no focus ring), or to the shown
 *    pane when the screen has no heading.
 * Then, once the screen's title is known, it is announced politely. The heading is also the screen's
 * focus target for the overlay host (where focus goes when a closing layer's opener has gone).
 */
import { useEffect, useRef, type RefObject } from 'react';
import { useAnnounce, useScreenFocusTarget } from '../../../kit';
import { LOUNGE_ROW_ATTRIBUTE, rememberedRow } from './routeMemory';

function shown(element: Element): boolean {
  return element.closest('[hidden], [inert]') === null;
}

function focusable(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected && shown(element);
}

/** The shown main landmark's heading, or the pane holding it when there is none. */
function screenTarget(root: HTMLElement): HTMLElement | null {
  const main = [...root.querySelectorAll('main, [role="main"]')].find(shown) ?? null;
  if (main === null) return null;
  const heading = main.querySelector('h1');
  if (heading instanceof HTMLElement && shown(heading)) {
    if (!heading.hasAttribute('tabindex')) {
      heading.setAttribute('tabindex', '-1');
      // A heading is not a control: focus lands on it only by script, to move the reading position.
      // No ring (the browser's default one would be off-system); the announcement says where the user is.
      heading.style.outline = 'none';
    }
    return heading;
  }
  const pane = main.closest('[tabindex="-1"]') ?? (main.getAttribute('tabindex') === '-1' ? main : null);
  return pane instanceof HTMLElement ? pane : null;
}

export interface RouteFocusProps {
  /** The frame's element (a `display: contents` wrapper is fine). */
  rootRef: RefObject<HTMLElement | null>;
  pathname: string;
  /** The screen's title; null while it is not known. */
  title: string | null;
}

export function RouteFocus({ rootRef, pathname, title }: RouteFocusProps): null {
  const announce = useAnnounce();
  const entered = useRef(false);
  const announcePending = useRef(false);
  const target = useRef<HTMLElement | null>(null);
  useScreenFocusTarget(target);

  useEffect(() => {
    const entry = !entered.current;
    entered.current = true;
    announcePending.current = true;
    const root = rootRef.current;
    if (root === null) return;
    target.current = screenTarget(root);

    if (entry) {
      const id = rememberedRow(pathname);
      const row =
        id === null
          ? null
          : ([...root.querySelectorAll(`[${LOUNGE_ROW_ATTRIBUTE}]`)].find(
              (element) => element.getAttribute(LOUNGE_ROW_ATTRIBUTE) === id,
            ) ?? null);
      if (focusable(row)) {
        row.focus();
        return;
      }
    }
    const active = document.activeElement;
    // A dialog or sheet is open (MUI marks the page behind it aria-hidden): never pull focus out of it.
    if (active !== null && active.closest('[role="dialog"], [aria-modal="true"]') !== null) {
      return;
    }
    if (active !== null && root.contains(active) && active.closest('nav') !== null && shown(active)) {
      return;
    }
    target.current?.focus({ preventScroll: true });
  }, [rootRef, pathname]);

  useEffect(() => {
    if (!announcePending.current || title === null) return;
    // Not over an open dialog: the user is in it, the screen behind changed.
    if (document.activeElement?.closest('[role="dialog"], [aria-modal="true"]')) {
      announcePending.current = false;
      return;
    }
    announcePending.current = false;
    announce(title);
  }, [announce, pathname, title]);

  return null;
}
