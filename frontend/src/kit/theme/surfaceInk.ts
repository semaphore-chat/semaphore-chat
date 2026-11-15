import { createContext, useContext } from 'react';

/**
 * What a kit component sits on. A selected ListRow is the solid accent
 * pill, so the kit components in its slots (icons, text, icon buttons, badges,
 * pills) switch to on-accent colours there. A Card is filled with the `fill`
 * colour, so the pieces that are `fill` themselves (a soft Button, a neutral
 * Pill, a field box) switch to `surface` there, or they would vanish.
 * Internal: no public prop. Content that is not a kit component keeps its own
 * colours and should avoid the slot.
 */
export type SurfaceInk = 'default' | 'onAccent' | 'onFill';

export const SurfaceInkContext = createContext<SurfaceInk>('default');

/** The ink under this component. */
export function useSurfaceInk(): SurfaceInk {
  return useContext(SurfaceInkContext);
}
