/** Where focus is, as the chat's entry and thread-close rules read it. */

/**
 * Whether the element has keyboard (focus-visible) focus, as against a press with the mouse. A browser without
 * `:focus-visible` (or an engine that throws on the selector) counts as keyboard: the cautious answer is to leave
 * the user's place alone.
 */
export function hasKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** The frame's pane that `useFollowFocus` focuses (`tabindex="-1"` around an island). */
function isLayoutPane(element: Element): boolean {
  return element.getAttribute('tabindex') === '-1' && element.querySelector('main, aside, nav') !== null;
}

/** Nothing the user chose has focus: the page body, the screen's heading (RouteFocus) or a layout pane. */
export function focusIsAtRest(active: Element | null): boolean {
  return active === null || active === document.body || active.tagName === 'H1' || isLayoutPane(active);
}
