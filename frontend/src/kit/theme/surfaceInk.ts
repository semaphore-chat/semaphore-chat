import { createContext, useContext } from 'react';

/**
 * The ink a kit component sits on. A selected ListRow is the solid accent
 * pill, so the kit components in its slots (icons, text, icon buttons, badges,
 * pills) switch to on-accent colours there. Internal: no public prop. Content
 * that is not a kit component keeps its own colours and should avoid the slot.
 */
export type SurfaceInk = 'default' | 'onAccent';

export const SurfaceInkContext = createContext<SurfaceInk>('default');

/** The ink under this component. */
export function useSurfaceInk(): SurfaceInk {
  return useContext(SurfaceInkContext);
}
