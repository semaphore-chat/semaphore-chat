import { matchRoutes, type RouteObject } from 'react-router-dom';
import type { WidthRange } from '../kit/layout/breakpoints';
import { CLASSIC_STATIC_PATHS, LOUNGE_FIXTURE_PREFIX, LOUNGE_ROUTES, type LoungeParams, type LoungeRoute } from './loungeRoutes';

export type ShellChoice =
  | { readonly kind: 'classic' }
  | { readonly kind: 'lounge'; readonly route: LoungeRoute; readonly params: LoungeParams };

export type LoungeChoice = Extract<ShellChoice, { kind: 'lounge' }>;

export const CLASSIC: ShellChoice = Object.freeze({ kind: 'classic' });

export interface ChooseShellInput {
  pathname: string;
  /** The new design is on: the account setting, or this tab's preview override. */
  enabled: boolean;
  width: WidthRange;
  /**
   * The desktop app (`utils/platform`'s `isElectron()`): only the test fixtures (`/__lounge...`) may be the
   * new shell there. The real screens are web-only for now, at every width and zoom.
   */
  electron?: boolean;
  routes?: readonly LoungeRoute[];
}

/** The route table chooseShell ranks: the registered routes, then the old shell's static siblings. */
type RankedRoute = RouteObject & { readonly lounge: LoungeRoute | null };

/** Built per call: a handful of entries, and the registry is read as it is now (tests change it in place). */
function rankedTable(routes: readonly LoungeRoute[]): RankedRoute[] {
  return [
    ...routes.map((route) => ({ path: route.path, lounge: route })),
    ...CLASSIC_STATIC_PATHS.map((path) => ({ path, lounge: null })),
  ];
}

/**
 * Which shell shows `pathname`. Pure.
 *
 * With the new design off the answer is the old shell, before anything else is
 * looked at. Otherwise the registered routes and the old shell's static siblings
 * (`CLASSIC_STATIC_PATHS`) are ranked as React Router ranks the old shell's own
 * table (a static segment beats a param; equal ranks keep their order), and the
 * best whole-path match decides: the old shell for a static sibling, the new
 * shell for a registered route converted at this width, the old shell if not.
 * A path nothing matches is the old shell's. In the desktop app only a fixture
 * can be the new shell.
 */
export function chooseShell({ pathname, enabled, width, electron = false, routes = LOUNGE_ROUTES }: ChooseShellInput): ShellChoice {
  if (!enabled) {
    return CLASSIC;
  }
  const matches = matchRoutes(rankedTable(routes), pathname);
  const match = matches?.[matches.length - 1];
  const route = match ? (match.route as RankedRoute).lounge : null;
  if (!match || route === null) {
    return CLASSIC;
  }
  if (!route.widths.includes(width)) {
    return CLASSIC;
  }
  if (electron && !route.path.startsWith(LOUNGE_FIXTURE_PREFIX)) {
    return CLASSIC;
  }
  return { kind: 'lounge', route, params: match.params };
}
