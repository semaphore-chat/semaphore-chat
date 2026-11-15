/**
 * The registry of routes the new design ("the Lounge") shows. Everything not
 * listed here, and everything at a width a route does not list, is shown by
 * the old shell (ClassicShell), exactly as before the switch existed.
 *
 * Eager and tiny on purpose: it imports types only. Each screen is its own
 * lazy chunk under shell/lounge/screens/, loaded through `load`, so nothing of
 * the kit (or its fonts) reaches the first page load.
 *
 * Rule: no real screen may be registered until the new shell has its own call
 * surface (the kit call bar and a video surface). Until then a converted screen
 * would leave a call's video tiles with nowhere to show. Only the marker, a
 * test fixture, is registered.
 */
import type { ComponentType } from 'react';
import type { WidthRange } from '../kit/layout/breakpoints';

/** Params of the matched pattern, as react-router's matchPath returns them. */
export type LoungeParams = Readonly<Partial<Record<string, string>>>;

export interface LoungeScreenProps {
  readonly params: LoungeParams;
}

export interface LoungeRoute {
  /**
   * Absolute pattern, also present in routes.tsx (the old screen for other widths and for the
   * setting off). Matched with matchPath({ path, end: true }), so "/community/:id" never matches
   * ".../channel/:cid".
   */
  readonly path: string;
  /** Kit width ranges where this route is converted. Elsewhere the old shell shows it. Non-empty. */
  readonly widths: readonly [WidthRange, ...WidthRange[]];
  /** The screen module, under shell/lounge/screens/. One chunk per screen. */
  readonly load: () => Promise<{ default: ComponentType<LoungeScreenProps> }>;
}

/** The path of the marker screen: a test fixture kept until the new design becomes the default. */
export const LOUNGE_MARKER_PATH = '/__lounge';

export const LOUNGE_ROUTES: readonly LoungeRoute[] = [
  {
    path: LOUNGE_MARKER_PATH,
    widths: ['phone', 'compact', 'wide'],
    load: () => import('./lounge/screens/MarkerScreen'),
  },
];
