/**
 * The registry of routes the new design ("the Lounge") shows. Everything not
 * listed here, and everything at a width a route does not list, is shown by
 * the old shell (ClassicShell), exactly as before the switch existed.
 *
 * Eager and tiny on purpose: it imports types only. Each screen is its own
 * lazy chunk under shell/lounge/screens/, loaded through `load`, so nothing of
 * the kit (or its fonts) reaches the first page load.
 *
 * The new shell has its own call surface (R8 closed): the frame's call slot
 * shows the call bar (shell/lounge/pieces/call), the call's video with Watch /
 * Stop watching (shell/lounge/call/surface, its own lazy chunk), and the voice
 * notice. So a converted three-islands screen no longer strands a call's video.
 * Only test fixtures are registered so far: the marker and the community
 * fixture, which assembles every piece of the shell on real data. Every
 * `/__lounge...` path is a fixture: with the new design off it is the old
 * shell's not-found page, and only a fixture's descriptor may set `links`.
 */
import type { WidthRange } from '../kit/layout/breakpoints';
import type { LoungeScreen } from './lounge/screen';

export type { LoungeParams, LoungeScreen, LoungeScreenProps } from './lounge/screen';

export interface LoungeRoute {
  /**
   * Absolute pattern, also present in routes.tsx (the old screen for other widths and for the
   * setting off). Matched with matchPath({ path, end: true }), so "/community/:id" never matches
   * ".../channel/:cid".
   */
  readonly path: string;
  /** Kit width ranges where this route is converted. Elsewhere the old shell shows it. Non-empty. */
  readonly widths: readonly [WidthRange, ...WidthRange[]];
  /**
   * The screen module, under shell/lounge/screens/. One chunk per screen. Its default export is the
   * screen's descriptor (shell/lounge/screen.ts): the template and the screen's parts.
   */
  readonly load: () => Promise<{ default: LoungeScreen }>;
}

/** The path of the marker screen: a test fixture kept until the new design becomes the default. */
export const LOUNGE_MARKER_PATH = '/__lounge';

/** Every test fixture's path starts with this. */
export const LOUNGE_FIXTURE_PREFIX = '/__lounge';

/**
 * A hidden three-islands fixture: a community's dock, left island, members, call slot and banners on real
 * data around a placeholder centre (shell/lounge/screens/CommunityFixtureScreen).
 */
export const LOUNGE_COMMUNITY_FIXTURE_PATH = '/__lounge/community/:communityId';

/** The community fixture's path for one community. */
export function loungeCommunityFixturePath(communityId: string): string {
  return `/__lounge/community/${communityId}`;
}

export const LOUNGE_ROUTES: readonly LoungeRoute[] = [
  {
    path: LOUNGE_MARKER_PATH,
    widths: ['phone', 'compact', 'wide'],
    load: () => import('./lounge/screens/MarkerScreen'),
  },
  {
    path: LOUNGE_COMMUNITY_FIXTURE_PATH,
    widths: ['phone', 'compact', 'wide'],
    load: () => import('./lounge/screens/CommunityFixtureScreen'),
  },
];
