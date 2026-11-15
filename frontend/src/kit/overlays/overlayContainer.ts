import { createContext, useContext } from 'react';

/**
 * Where a floating layer renders. A Dialog provides its own container element
 * so a Popover, Tooltip, Menu or SelectField list opened from inside it renders
 * within it: the Dialog's focus trap only accepts focus inside that element,
 * and it hides the rest of the page from assistive technology. Outside a Dialog
 * the value is null and layers render at the end of the page.
 */
export const OverlayContainerContext = createContext<HTMLElement | null>(null);

/** The element a layer should render into, or null for the end of the page. */
export function useOverlayContainer(): HTMLElement | null {
  return useContext(OverlayContainerContext);
}
