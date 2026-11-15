/**
 * chooseShell: the pure decision between the old shell and the new design's.
 * The route table is read from the real routes.tsx, so "setting off is the old
 * shell everywhere" is checked over every route the app has.
 */
import { describe, it, expect } from 'vitest';
import { createRoutesFromChildren, matchRoutes, type RouteObject } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AppRoutes } from '../../routes';
import { chooseShell } from '../../shell/chooseShell';
import { LOUNGE_MARKER_PATH, LOUNGE_ROUTES, type LoungeRoute } from '../../shell/loungeRoutes';
import type { WidthRange } from '../../kit/layout/breakpoints';

const WIDTHS: WidthRange[] = ['phone', 'compact', 'wide'];

/** Every route object of the app, from routes.tsx. */
function appRoutes(): RouteObject[] {
  const element = AppRoutes({}) as ReactElement<{ children: ReactElement }>;
  return createRoutesFromChildren(element.props.children);
}

/** Every path in the route table, absolute, with `:params` filled in so it can be matched like a URL. */
function concretePaths(routes: RouteObject[], parent = ''): string[] {
  const out: string[] = [];
  for (const route of routes) {
    const joined = route.path === undefined ? parent : route.path.startsWith('/') ? route.path : `${parent.replace(/\/$/, '')}/${route.path}`;
    const concrete = joined.replace(/:(\w+)/g, 'x-$1').replace(/\*$/, 'some/unknown/page') || '/';
    if (route.path !== undefined || route.index) out.push(concrete);
    if (route.children) out.push(...concretePaths(route.children, joined));
  }
  return [...new Set(out)];
}

const fakeLoad: LoungeRoute['load'] = () =>
  Promise.resolve({ default: { template: 'bare', Body: () => null, useTitle: () => null } });

describe('chooseShell', () => {
  const paths = concretePaths(appRoutes());

  it('reads a real route table', () => {
    expect(paths).toEqual(expect.arrayContaining(['/', '/settings', '/community/x-communityId/channel/x-channelId', '/login']));
    expect(paths.length).toBeGreaterThan(30);
  });

  it.each(WIDTHS)('with the new design off, every route of the app is the old shell at %s width', (width) => {
    for (const pathname of [...paths, LOUNGE_MARKER_PATH]) {
      expect(chooseShell({ pathname, enabled: false, width }), pathname).toEqual({ kind: 'classic' });
    }
  });

  it('with the new design on, a route that is not registered is the old shell', () => {
    for (const width of WIDTHS) {
      for (const pathname of paths) {
        expect(chooseShell({ pathname, enabled: true, width }), `${pathname} at ${width}`).toEqual({ kind: 'classic' });
      }
    }
  });

  it('with the new design on, the marker is the new shell at every width', () => {
    for (const width of WIDTHS) {
      const choice = chooseShell({ pathname: '/__lounge', enabled: true, width });
      expect(choice.kind).toBe('lounge');
      expect(choice.kind === 'lounge' && choice.route.path).toBe(LOUNGE_MARKER_PATH);
    }
  });

  it('a registered route outside its widths is the old shell', () => {
    const routes: LoungeRoute[] = [{ path: '/community/:communityId', widths: ['phone'], load: fakeLoad }];
    expect(chooseShell({ pathname: '/community/c1', enabled: true, width: 'phone', routes }).kind).toBe('lounge');
    expect(chooseShell({ pathname: '/community/c1', enabled: true, width: 'compact', routes })).toEqual({ kind: 'classic' });
    expect(chooseShell({ pathname: '/community/c1', enabled: true, width: 'wide', routes })).toEqual({ kind: 'classic' });
  });

  it('extracts the params of the matched pattern', () => {
    const routes: LoungeRoute[] = [{ path: '/community/:communityId/channel/:channelId', widths: ['wide'], load: fakeLoad }];
    const choice = chooseShell({ pathname: '/community/c1/channel/ch2', enabled: true, width: 'wide', routes });
    expect(choice).toEqual({ kind: 'lounge', route: routes[0], params: { communityId: 'c1', channelId: 'ch2' } });
  });

  it('matches the whole path only: a community route does not match one of its channels', () => {
    const routes: LoungeRoute[] = [{ path: '/community/:communityId', widths: ['wide'], load: fakeLoad }];
    expect(chooseShell({ pathname: '/community/c1/channel/ch2', enabled: true, width: 'wide', routes })).toEqual({ kind: 'classic' });
    expect(chooseShell({ pathname: '/__lounge/more', enabled: true, width: 'wide' })).toEqual({ kind: 'classic' });
  });

  it('the first registered match decides, even when it is not converted at this width', () => {
    const first: LoungeRoute = { path: '/a/:id', widths: ['phone'], load: fakeLoad };
    const second: LoungeRoute = { path: '/a/:other', widths: ['wide'], load: fakeLoad };
    expect(chooseShell({ pathname: '/a/1', enabled: true, width: 'wide', routes: [first, second] })).toEqual({ kind: 'classic' });
  });
});

describe('the registry (LOUNGE_ROUTES)', () => {
  const table = appRoutes();

  it('has unique paths, each with at least one width', () => {
    const registered = LOUNGE_ROUTES.map((route) => route.path);
    expect(new Set(registered).size).toBe(registered.length);
    for (const route of LOUNGE_ROUTES) expect(route.widths.length).toBeGreaterThan(0);
  });

  it('registers only the marker for now (no real screen before the new shell has a call surface)', () => {
    expect(LOUNGE_ROUTES.map((route) => route.path)).toEqual([LOUNGE_MARKER_PATH]);
  });

  it("every registered real path is an old screen in routes.tsx, and the marker is the old shell's not-found page", () => {
    for (const route of LOUNGE_ROUTES) {
      const sample = route.path.replace(/:(\w+)/g, 'x-$1');
      const matches = matchRoutes(table, sample) ?? [];
      const leaf = matches[matches.length - 1]?.route;
      if (route.path === LOUNGE_MARKER_PATH) {
        expect(leaf?.path, 'the marker falls through to *').toBe('*');
      } else {
        expect(leaf?.path, `${route.path} must exist in routes.tsx`).not.toBe('*');
        expect(leaf, `${route.path} must exist in routes.tsx`).toBeDefined();
      }
    }
  });

  it('every screen loads from shell/lounge/screens/', () => {
    for (const route of LOUNGE_ROUTES) {
      expect(route.load.toString()).toMatch(/lounge\/screens\//);
    }
  });
});
