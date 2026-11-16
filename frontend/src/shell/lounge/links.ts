/**
 * Where the shell's own community links lead (the dock's items, the "All communities" sheet's rows).
 *
 * In the app a community link is its route, `#/community/:id`. A hidden test fixture that stands in for a
 * screen not registered yet (`/__lounge/community/:communityId`) sets its descriptor's `links` so a tap stays
 * on the fixture, and the frame (dock, left island, members, call bar) stays mounted between communities.
 * Real screens never set `links` (the registry test checks it). Channel links are not here: a channel opens
 * its own route.
 */
import { createContext, useContext } from 'react';

export interface LoungeLinks {
  /** A hash href to the community's screen. */
  community(id: string): string;
}

export const APP_LINKS: LoungeLinks = Object.freeze({
  community: (id: string) => `#/community/${id}`,
});

export const LoungeLinksContext = createContext<LoungeLinks>(APP_LINKS);

/** The links the current screen's frame uses; the app's routes outside a fixture. */
export function useLoungeLinks(): LoungeLinks {
  return useContext(LoungeLinksContext);
}
