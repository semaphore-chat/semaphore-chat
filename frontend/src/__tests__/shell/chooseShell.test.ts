/**
 * chooseShell: the pure decision between the old shell and the new design's.
 * The route table is read from the real routes.tsx, so "setting off is the old
 * shell everywhere" is checked over every route the app has.
 */
import { describe, it, expect } from 'vitest';
import { createRoutesFromChildren, matchPath, matchRoutes, type RouteObject } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AppRoutes } from '../../routes';
import { chooseShell } from '../../shell/chooseShell';
import {
  CHANNEL_CHAT_PATH,
  CLASSIC_STATIC_PATHS,
  COMMUNITY_HOME_PATH,
  LOUNGE_CHAT_FIXTURE_PATH,
  LOUNGE_COMMUNITY_FIXTURE_PATH,
  LOUNGE_FIXTURE_PREFIX,
  LOUNGE_MARKER_PATH,
  LOUNGE_ROUTES,
  loungeChatFixturePath,
  loungeCommunityFixturePath,
  type LoungeRoute,
} from '../../shell/loungeRoutes';
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
    for (const pathname of [...paths, LOUNGE_MARKER_PATH, loungeCommunityFixturePath('c-1')]) {
      expect(chooseShell({ pathname, enabled: false, width }), pathname).toEqual({ kind: 'classic' });
    }
  });

  it('with the new design on, a route that is not registered is the old shell', () => {
    for (const width of WIDTHS) {
      for (const pathname of paths) {
        if (width === 'phone' && (pathname === '/community/x-communityId' || pathname === '/community/x-communityId/channel/x-channelId')) continue;
        expect(chooseShell({ pathname, enabled: true, width }), `${pathname} at ${width}`).toEqual({ kind: 'classic' });
      }
    }
  });

  it('with the new design on, /community/:id is the new shell at phone only, with its community', () => {
    const choice = chooseShell({ pathname: '/community/c-1', enabled: true, width: 'phone' });
    expect(choice.kind === 'lounge' && choice.route.path).toBe(COMMUNITY_HOME_PATH);
    expect(choice.kind === 'lounge' && choice.params).toEqual({ communityId: 'c-1' });
    expect(chooseShell({ pathname: '/community/c-1', enabled: true, width: 'compact' })).toEqual({ kind: 'classic' });
    expect(chooseShell({ pathname: '/community/c-1', enabled: true, width: 'wide' })).toEqual({ kind: 'classic' });
    // A channel's search and the community's settings stay the old shell's.
    for (const pathname of ['/community/c-1/channel/ch-2/search', '/community/c-1/edit']) {
      expect(chooseShell({ pathname, enabled: true, width: 'phone' }), pathname).toEqual({ kind: 'classic' });
    }
  });

  it('/community/create and /community/:id/edit stay classic at every width', () => {
    for (const width of WIDTHS) {
      for (const pathname of ['/community/create', '/community/create/', '/community/CREATE', '/community/x/edit']) {
        expect(chooseShell({ pathname, enabled: true, width }), `${pathname} at ${width}`).toEqual({ kind: 'classic' });
      }
    }
  });

  it("no Lounge route claims a path the old router gives to another route (every route of routes.tsx, and samples)", () => {
    const table = appRoutes();
    const fullPattern = (pathname: string) =>
      (matchRoutes(table, pathname) ?? [])
        .map((match) => match.route.path)
        .filter((path): path is string => path !== undefined)
        .reduce((joined, path) => (path.startsWith('/') ? path : `${joined.replace(/\/$/, '')}/${path}`), '');
    const samples = [...paths, '/community/create', '/community/x/edit', '/community/x/channel/y', '/community/x'];
    let claimed = 0;
    for (const pathname of samples) {
      for (const width of WIDTHS) {
        const choice = chooseShell({ pathname, enabled: true, width });
        if (choice.kind !== 'lounge' || choice.route.path.startsWith(LOUNGE_FIXTURE_PREFIX)) continue;
        claimed += 1;
        expect(fullPattern(pathname), `${pathname} at ${width}: the old router's leaf is the Lounge route's pattern`).toBe(choice.route.path);
      }
    }
    // The walk saw the real community home (so it bites), and the guard is what keeps create away.
    expect(claimed).toBeGreaterThan(0);
    expect(CLASSIC_STATIC_PATHS).toContain('/community/create');
  });

  it('the guard bites: without the static siblings ranked in, /community/create would be the community home', () => {
    // The same match a plain matchPath makes; the ranking against CLASSIC_STATIC_PATHS is what stops it.
    expect(matchPath({ path: COMMUNITY_HOME_PATH, end: true }, '/community/create')?.params).toEqual({ communityId: 'create' });
  });

  it('in Electron a real route is classic at every width; fixtures are unchanged', () => {
    for (const width of WIDTHS) {
      expect(chooseShell({ pathname: '/community/c-1', enabled: true, width, electron: true }), width).toEqual({ kind: 'classic' });
      expect(chooseShell({ pathname: LOUNGE_MARKER_PATH, enabled: true, width, electron: true }).kind, width).toBe('lounge');
      expect(chooseShell({ pathname: loungeCommunityFixturePath('c-1'), enabled: true, width, electron: true }).kind, width).toBe('lounge');
    }
    // Any real route a later PR registers is gated too.
    const routes: LoungeRoute[] = [{ path: '/settings', widths: ['phone', 'compact', 'wide'], load: fakeLoad }];
    expect(chooseShell({ pathname: '/settings', enabled: true, width: 'wide', electron: true, routes })).toEqual({ kind: 'classic' });
    expect(chooseShell({ pathname: '/settings', enabled: true, width: 'wide', electron: false, routes }).kind).toBe('lounge');
  });

  it('with the new design on, the marker is the new shell at every width', () => {
    for (const width of WIDTHS) {
      const choice = chooseShell({ pathname: '/__lounge', enabled: true, width });
      expect(choice.kind).toBe('lounge');
      expect(choice.kind === 'lounge' && choice.route.path).toBe(LOUNGE_MARKER_PATH);
    }
  });

  it('with the new design on, the community fixture is the new shell at every width, with its community', () => {
    for (const width of WIDTHS) {
      const choice = chooseShell({ pathname: loungeCommunityFixturePath('c-1'), enabled: true, width });
      expect(choice.kind === 'lounge' && choice.route.path).toBe(LOUNGE_COMMUNITY_FIXTURE_PATH);
      expect(choice.kind === 'lounge' && choice.params).toEqual({ communityId: 'c-1' });
    }
    // Deeper paths under a channel are nobody's fixture: the old shell's (an unknown page).
    expect(chooseShell({ pathname: '/__lounge/community/c-1/channel/ch-2/search', enabled: true, width: 'wide' })).toEqual({ kind: 'classic' });
  });

  it('with the new design on, the chat fixture is the new shell at every width, with its community and channel', () => {
    for (const width of WIDTHS) {
      const choice = chooseShell({ pathname: loungeChatFixturePath('c-1', 'ch-2'), enabled: true, width });
      expect(choice.kind === 'lounge' && choice.route.path).toBe(LOUNGE_CHAT_FIXTURE_PATH);
      expect(choice.kind === 'lounge' && choice.params).toEqual({ communityId: 'c-1', channelId: 'ch-2' });
    }
  });

  describe('the real channel route', () => {
    const pathname = '/community/c-1/channel/ch-2';

    it('is the new shell at phone width, with its community and channel', () => {
      const choice = chooseShell({ pathname, enabled: true, width: 'phone' });
      expect(choice.kind === 'lounge' && choice.route.path).toBe(CHANNEL_CHAT_PATH);
      expect(choice.kind === 'lounge' && choice.params).toEqual({ communityId: 'c-1', channelId: 'ch-2' });
    });

    it('is the old shell at tablet and desktop widths, and with the new design off at every width', () => {
      expect(chooseShell({ pathname, enabled: true, width: 'compact' })).toEqual({ kind: 'classic' });
      expect(chooseShell({ pathname, enabled: true, width: 'wide' })).toEqual({ kind: 'classic' });
      for (const width of WIDTHS) expect(chooseShell({ pathname, enabled: false, width }), width).toEqual({ kind: 'classic' });
    });

    it('is the old shell in Electron at every width', () => {
      for (const width of WIDTHS) {
        expect(chooseShell({ pathname, enabled: true, width, electron: true }), width).toEqual({ kind: 'classic' });
      }
      // The chat fixture is not gated.
      expect(chooseShell({ pathname: loungeChatFixturePath('c-1', 'ch-2'), enabled: true, width: 'phone', electron: true }).kind).toBe('lounge');
    });

    it('matches the whole path: the channel search and anything longer under it stay the old shell\'s', () => {
      for (const deeper of [
        `${pathname}/search`,
        `${pathname}/search/more`,
        `${pathname}/x`,
        '/community/c-1/channel',
        '/community/c-1/channels/ch-2',
      ]) {
        for (const width of WIDTHS) {
          expect(chooseShell({ pathname: deeper, enabled: true, width }), `${deeper} at ${width}`).toEqual({ kind: 'classic' });
        }
      }
      // A trailing slash is the same route (as the old router has it).
      expect(chooseShell({ pathname: `${pathname}/`, enabled: true, width: 'phone' }).kind).toBe('lounge');
    });

    it('a known voice channel is the old shell (its call view); a text channel and the fixture are not affected', () => {
      const voiceChannels = new Set(['v-1']);
      expect(chooseShell({ pathname: '/community/c-1/channel/v-1', enabled: true, width: 'phone', voiceChannels })).toEqual({ kind: 'classic' });
      expect(chooseShell({ pathname, enabled: true, width: 'phone', voiceChannels }).kind).toBe('lounge');
      expect(chooseShell({ pathname: '/community/v-1', enabled: true, width: 'phone', voiceChannels }).kind).toBe('lounge');
      expect(chooseShell({ pathname: loungeChatFixturePath('c-1', 'v-1'), enabled: true, width: 'phone', voiceChannels }).kind).toBe('lounge');
    });
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

/** The registered paths outside `/__lounge` whose descriptor sets `links` (only a fixture may). */
async function routesSettingLinksOutsideFixtures(routes: readonly LoungeRoute[]): Promise<string[]> {
  const offenders: string[] = [];
  for (const route of routes) {
    if (route.path.startsWith(LOUNGE_FIXTURE_PREFIX)) continue;
    const { default: screen } = await route.load();
    if (screen.template === 'threeIslands' && screen.links !== undefined) offenders.push(route.path);
  }
  return offenders;
}

describe('the registry (LOUNGE_ROUTES)', () => {
  const table = appRoutes();

  it('has unique paths, each with at least one width', () => {
    const registered = LOUNGE_ROUTES.map((route) => route.path);
    expect(new Set(registered).size).toBe(registered.length);
    for (const route of LOUNGE_ROUTES) expect(route.widths.length).toBeGreaterThan(0);
  });

  it('registers the fixtures and the phone community home', () => {
    expect(LOUNGE_ROUTES.map((route) => route.path)).toEqual([
      LOUNGE_MARKER_PATH,
      LOUNGE_COMMUNITY_FIXTURE_PATH,
      LOUNGE_CHAT_FIXTURE_PATH,
      COMMUNITY_HOME_PATH,
      CHANNEL_CHAT_PATH,
    ]);
    expect(LOUNGE_ROUTES.find((route) => route.path === COMMUNITY_HOME_PATH)?.widths).toEqual(['phone']);
    expect(LOUNGE_ROUTES.find((route) => route.path === CHANNEL_CHAT_PATH)?.widths).toEqual(['phone']);
  });

  it("the channel chat: the chat fixture's descriptor without links", async () => {
    const real = (await LOUNGE_ROUTES.find((route) => route.path === CHANNEL_CHAT_PATH)!.load()).default;
    const fixture = (await LOUNGE_ROUTES.find((route) => route.path === LOUNGE_CHAT_FIXTURE_PATH)!.load()).default;
    expect(real.template === 'threeIslands' && real.links).toBeUndefined();
    const { links: _links, ...fixtureWithoutLinks } = fixture as Extract<typeof fixture, { template: 'threeIslands' }>;
    expect(real).toEqual(fixtureWithoutLinks);
  });

  it('the community home: threeIslands, community, left pane on a phone, the redirecting centre, the members island, no links', async () => {
    const route = LOUNGE_ROUTES.find((candidate) => candidate.path === COMMUNITY_HOME_PATH)!;
    const { default: screen } = await route.load();
    const { CommunityRedirect } = await import('../../shell/lounge/screens/CommunityRedirect');
    expect(screen).toMatchObject({ template: 'threeIslands', place: 'community', phonePane: 'left', Centre: CommunityRedirect, right: 'members' });
    expect(screen.template === 'threeIslands' && screen.links).toBeUndefined();
  });

  it("every registered real path is an old screen in routes.tsx, and the fixtures are the old shell's not-found page", () => {
    for (const route of LOUNGE_ROUTES) {
      const sample = route.path.replace(/:(\w+)/g, 'x-$1');
      const matches = matchRoutes(table, sample) ?? [];
      const leaf = matches[matches.length - 1]?.route;
      if (route.path.startsWith(LOUNGE_FIXTURE_PREFIX)) {
        expect(leaf?.path, `the fixture ${route.path} falls through to *`).toBe('*');
      } else {
        expect(leaf?.path, `${route.path} must exist in routes.tsx`).not.toBe('*');
        expect(leaf, `${route.path} must exist in routes.tsx`).toBeDefined();
      }
    }
  });

  it('only a fixture sets `links`: a real screen links to the app\'s routes', async () => {
    expect(await routesSettingLinksOutsideFixtures(LOUNGE_ROUTES)).toEqual([]);
    // The rule bites: a real route whose descriptor sets links is reported.
    const realWithLinks: LoungeRoute = {
      path: '/community/:communityId',
      widths: ['phone'],
      load: async () => ({
        default: {
          template: 'threeIslands',
          place: 'community',
          phonePane: 'left',
          Centre: null,
          right: 'members',
          useTitle: () => null,
          links: { community: (id: string) => `#/x/${id}`, channel: (c: string, ch: string) => `#/x/${c}/${ch}` },
        },
      }),
    };
    expect(await routesSettingLinksOutsideFixtures([...LOUNGE_ROUTES, realWithLinks])).toEqual(['/community/:communityId']);
  });

  it('the community fixture keeps its dock and sheet on the fixture', async () => {
    const route = LOUNGE_ROUTES.find((candidate) => candidate.path === LOUNGE_COMMUNITY_FIXTURE_PATH)!;
    const { default: screen } = await route.load();
    expect(screen.template).toBe('threeIslands');
    if (screen.template !== 'threeIslands') return;
    expect(screen.links?.community('c-2')).toBe(`#${loungeCommunityFixturePath('c-2')}`);
    expect(screen.links?.channel('c-2', 'ch-3')).toBe(`#${loungeChatFixturePath('c-2', 'ch-3')}`);
    expect(screen).toMatchObject({ place: 'community', phonePane: 'left', right: 'members' });
  });

  it('the chat fixture: threeIslands, community, the centre on a phone, its own members, fixture links', async () => {
    const route = LOUNGE_ROUTES.find((candidate) => candidate.path === LOUNGE_CHAT_FIXTURE_PATH)!;
    expect(route.widths).toEqual(['phone', 'compact', 'wide']);
    const { default: screen } = await route.load();
    expect(screen).toMatchObject({ template: 'threeIslands', place: 'community', phonePane: 'centre', rightLabel: 'Members' });
    if (screen.template !== 'threeIslands') return;
    expect(typeof screen.right).toBe('function');
    expect(screen.links?.channel('c-1', 'ch-2')).toBe(`#${loungeChatFixturePath('c-1', 'ch-2')}`);
  });

  it('every screen loads from shell/lounge/screens/', () => {
    for (const route of LOUNGE_ROUTES) {
      expect(route.load.toString()).toMatch(/lounge\/screens\//);
    }
  });
});
