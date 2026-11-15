import { matchPath } from 'react-router-dom';
import type { WidthRange } from '../kit/layout/breakpoints';
import { LOUNGE_ROUTES, type LoungeParams, type LoungeRoute } from './loungeRoutes';

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
  routes?: readonly LoungeRoute[];
}

/**
 * Which shell shows `pathname`. Pure.
 *
 * With the new design off the answer is the old shell, before anything else is
 * looked at. Otherwise the first registered route that matches the whole path
 * decides: the new shell if it is converted at this width, the old shell if not.
 * A path nothing matches is the old shell's.
 */
export function chooseShell({ pathname, enabled, width, routes = LOUNGE_ROUTES }: ChooseShellInput): ShellChoice {
  if (!enabled) {
    return CLASSIC;
  }
  for (const route of routes) {
    const match = matchPath({ path: route.path, end: true }, pathname);
    if (match === null) {
      continue;
    }
    if (!route.widths.includes(width)) {
      return CLASSIC;
    }
    return { kind: 'lounge', route, params: match.params };
  }
  return CLASSIC;
}
