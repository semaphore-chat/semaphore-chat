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
 *
 * Registered: the test fixtures (the marker, the community fixture, which
 * assembles every piece of the shell on real data, and the chat fixture) and two real screens at every
 * width: the community home (`COMMUNITY_HOME_PATH`) and a text channel's chat (`CHANNEL_CHAT_PATH`). Every
 * `/__lounge...` path is a fixture: with the new design off it is the old
 * shell's not-found page, and only a fixture's descriptor may set `links`.
 * A real (non-fixture) route is never the new shell in the desktop app
 * (`chooseShell`'s `electron` input).
 */
import type { WidthRange } from '../kit/layout/breakpoints';
import type { LoungeScreen } from './lounge/screen';

export type { LoungeParams, LoungeScreen, LoungeScreenProps } from './lounge/screen';

export interface LoungeRoute {
  /**
   * Absolute pattern, also present in routes.tsx (the old screen for other widths and for the
   * setting off). Matched as a whole path and ranked as the old router ranks (`chooseShell`), so
   * "/community/:id" never matches ".../channel/:cid" and never takes "/community/create".
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

/**
 * A hidden chat fixture: the new shell's text channel chat inside the community's frame, reached from the community
 * fixture's channel rows. The same screen as the real `CHANNEL_CHAT_PATH`, with the fixtures' links.
 */
export const LOUNGE_CHAT_FIXTURE_PATH = '/__lounge/community/:communityId/channel/:channelId';

/** The chat fixture's path for one channel. */
export function loungeChatFixturePath(communityId: string, channelId: string): string {
  return `/__lounge/community/${communityId}/channel/${channelId}`;
}

/**
 * The community home: the community's channels and rooms. At compact and wide its centre redirects to the last (or
 * first) text channel (`CommunityRedirect`).
 */
export const COMMUNITY_HOME_PATH = '/community/:communityId';

/**
 * A channel's chat. The new shell's for a text channel only: a voice channel's route is the
 * old shell's call view (`chooseShell`'s `voiceChannels`). `.../search` and the rest under it stay the old shell's
 * (whole-path match).
 */
export const CHANNEL_CHAT_PATH = '/community/:communityId/channel/:channelId';

/**
 * The old shell's static routes that a registered pattern would also match (`/community/create` is
 * `/community/:communityId` with `communityId = 'create'`). `chooseShell` ranks them with the registered
 * routes the way the old router does (a static segment outranks a param), so the old shell keeps them.
 * The registry test walks every route of routes.tsx and fails when one is missing here.
 */
export const CLASSIC_STATIC_PATHS: readonly string[] = ['/community/create'];

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
  {
    path: LOUNGE_CHAT_FIXTURE_PATH,
    widths: ['phone', 'compact', 'wide'],
    load: () => import('./lounge/screens/ChatFixtureScreen'),
  },
  {
    path: COMMUNITY_HOME_PATH,
    widths: ['phone', 'compact', 'wide'],
    load: () => import('./lounge/screens/CommunityHomeScreen'),
  },
  {
    path: CHANNEL_CHAT_PATH,
    widths: ['phone', 'compact', 'wide'],
    load: () => import('./lounge/screens/ChannelChatScreen'),
  },
];
