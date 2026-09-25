/**
 * Fixture helpers for the "states" edge-case area (network / loading /
 * error / empty states and theming) — used only by
 * `src/stories/edge/states/EdgeStates*.stories.tsx`.
 *
 * Plain `.ts` (no JSX) on purpose: this file exports both components and
 * functions, which `react-refresh/only-export-components` only polices in
 * `.tsx` files.
 *
 * What's here and why:
 *  - `edgeScreen()` — `defineScreen()` plus the app-level chrome the real
 *    app mounts around every authenticated screen but `StoryRoutes` doesn't
 *    (`OfflineBanner`, `UpdateToast`, `PWAInstallPrompt` from `App.tsx`;
 *    `ConnectionStatusBanner` from `AuthGate.tsx`), a socket-connected
 *    toggle, an optional "connected to voice" state (same fake-Room setup as
 *    `screens/VoiceConnected.stories.tsx`), and an optional per-story theme.
 *  - Per-story theme: Ladle's global `Provider` (`.ladle/components.tsx`)
 *    forces the app theme's *mode* to Ladle's own light/dark toggle, so a
 *    story can't choose its own mode through it. `edgeScreen({ theme })`
 *    instead nests a second, real app `ThemeProvider` (+ `CssBaseline`)
 *    around the story and serves the chosen settings from
 *    `GET /api/appearance-settings` — the app's own `useThemeSync()` (in
 *    `Layout.tsx`) then applies them exactly as it does on a real login
 *    ("server wins"). Nothing about the theme is hard-coded in the story.
 *  - Effects that drive browser-level state: being offline
 *    (`navigator.onLine`, which `OfflineBanner` reads on mount),
 *    a waiting service-worker update (`swUpdate.setUpdateAvailable`, what
 *    `main.tsx`'s `registerSW({ onNeedRefresh })` calls), and a captured
 *    `beforeinstallprompt` on an Android user agent (the only case
 *    `PWAInstallPrompt` shows — it's suppressed on desktop browsers).
 */
import React, { useEffect, useState } from 'react';
import { createElement as h, Fragment, type ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import GlobalStyles from '@mui/material/GlobalStyles';
import { http, HttpResponse, delay, type HttpHandler } from 'msw';
import type { AppearanceSettingsResponseDto } from '../../../api-client/types.gen';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import type { ThemeSettings } from '../../../theme/constants';
import { VoiceSessionType, type VoiceState } from '../../../contexts/VoiceContext';
import { ConnectionStatusBanner } from '../../../components/ConnectionStatusBanner';
import { AppChrome } from '../../../components/PWA/AppChrome';
import { setUpdateAvailable } from '../../../utils/swUpdate';
import { SandboxShell } from '../SandboxShell';
import { StoryRoutes } from '../StoryRoutes';
import { makeHandlers } from '../handlers';
import { createFakeVoiceRoom } from '../fakeRoom';
import { FakeRoomProvider } from '../FakeRoomProvider';
import type { LadleStoryComponent } from '../screenStory';
import type { Scenario } from '../types';

// ── Handlers ─────────────────────────────────────────────────────────────

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * A request that never resolves while the story is on screen — the screenshot
 * sweep settles ~2s after load, so this pins a screen in its loading state.
 * Same as `withSlowEndpoint` with a long delay (MSW-served requests don't
 * block Playwright's `networkidle`, so a pending one doesn't stall the sweep).
 */
export function withHangingEndpoint(method: Method, path: string): HttpHandler {
  return http[method](path, async () => {
    await delay(10 * 60_000);
    return HttpResponse.json({});
  });
}

/**
 * Answer every `/api/...` request whose path mentions `id` with `status` —
 * e.g. every endpoint a deep link to a deleted channel or a private channel
 * you're not in would hit (channel, messages, pins, read receipts...).
 */
export function withStatusForId(id: string, status: number, body: Record<string, unknown>): HttpHandler {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return http.all(new RegExp(`/api/.*${escaped}`), () => HttpResponse.json(body, { status }));
}

/**
 * The exact 403 body NestJS returns when `RbacGuard.canActivate()` returns
 * false (backend/src/auth/rbac.guard.ts) — the default `ForbiddenException`
 * message from `@nestjs/core`'s guard consumer.
 */
export const FORBIDDEN_BODY = { message: 'Forbidden resource', error: 'Forbidden', statusCode: 403 };
/** NestJS `NotFoundException` body. */
export const NOT_FOUND_BODY = { message: 'Not Found', error: 'Not Found', statusCode: 404 };
/** NestJS's default 500 body for an unhandled exception. */
export const INTERNAL_ERROR_BODY = { statusCode: 500, message: 'Internal server error' };

function appearanceHandler(scenario: Scenario, theme: ThemeSettings): HttpHandler {
  return http.get('/api/appearance-settings', () =>
    HttpResponse.json({
      id: 'appearance-1',
      userId: scenario.me.id,
      themeMode: theme.mode,
      accentColor: theme.accentColor,
      intensity: theme.intensity,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    } satisfies AppearanceSettingsResponseDto),
  );
}

// ── Effect components (render nothing) ───────────────────────────────────

/**
 * Report the browser as offline from the first render. `OfflineBanner`
 * reads `navigator.onLine` for its initial state, so it opens straight away
 * (this component renders before it — see `edgeScreen`).
 *
 * Deliberately NOT dispatching the window `offline` event: TanStack Query's
 * `onlineManager` listens to it and would pause the screen's own fixture
 * queries mid-load, leaving an empty/"?"-avatar screen that isn't the state
 * under test ("connectivity dropped while the app was open, cached data
 * still on screen"). Waiting for the data to load first and then
 * dispatching the event races the screenshot sweep's fixed settle delay
 * (desktop screens only finish loading ~2s after `networkidle`).
 */
export const StartOffline: React.FC = () => {
  useState(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    return null;
  });
  useEffect(
    () => () => {
      // Drop the own-property shadow so the prototype getter is visible again.
      delete (navigator as unknown as Record<string, unknown>).onLine;
    },
    [],
  );
  return null;
};

/** Signal "a new service worker is waiting" the same way `main.tsx`'s `onNeedRefresh` does. */
export const SignalUpdateAvailable: React.FC = () => {
  useEffect(() => {
    setUpdateAvailable(true);
    return () => setUpdateAvailable(false);
  }, []);
  return null;
};

const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

/**
 * Pretend to be Chrome on Android and fire a (fake, never-actually-prompting)
 * `beforeinstallprompt` — `utils/installPrompt.ts` captures it exactly as it
 * would a real one. `PWAInstallPrompt` is deliberately hidden on desktop
 * browsers (`isDesktopBrowser()` is UA-based), so the UA spoof is what makes
 * it eligible; without it no viewport would ever show the snackbar.
 */
export const FireInstallPrompt: React.FC = () => {
  useEffect(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ANDROID_CHROME_UA });
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt: () => Promise.resolve(), userChoice: new Promise(() => {}) });
    window.dispatchEvent(event);
    return () => {
      delete (navigator as unknown as Record<string, unknown>).userAgent;
      window.dispatchEvent(new Event('appinstalled'));
    };
  }, []);
  return null;
};

// ── edgeScreen ───────────────────────────────────────────────────────────

export interface EdgeScreenOptions {
  extraHandlers?: HttpHandler[];
  /** Extra overlay nodes (e.g. `ClickOnMount`s). */
  overlay?: ReactNode;
  /** Fake `SocketContext.isConnected` — `false` shows `ConnectionStatusBanner`. */
  isSocketConnected?: boolean;
  /** Connect "me" to the first community's first voice channel (voice bar showing). */
  voice?: boolean;
  /** Serve these appearance settings and apply them via the app's own sync path. */
  theme?: ThemeSettings;
  offline?: boolean;
  updateAvailable?: boolean;
  installPrompt?: boolean;
}

function voiceSetup(scenario: Scenario): { voiceState: Partial<VoiceState>; wrap: (children: ReactNode) => ReactNode } {
  const community = scenario.communities[0];
  const channel = community.channels.find((c) => c.type === 'VOICE')!;
  const presence = scenario.voicePresenceByChannel[channel.id] ?? [];
  const room = createFakeVoiceRoom(scenario.me, presence);
  return {
    voiceState: {
      isConnected: true,
      contextType: VoiceSessionType.Channel,
      currentChannelId: channel.id,
      channelName: channel.name,
      communityId: community.id,
      isPrivate: false,
      createdAt: '2026-09-22T12:00:00Z',
    },
    wrap: (children) => h(FakeRoomProvider, { room, children }),
  };
}

/**
 * Like `defineScreen()`, plus the app-level chrome and edge-state toggles
 * described in this file's header.
 */
export function edgeScreen(scenario: Scenario, path: string, options: EdgeScreenOptions = {}): LadleStoryComponent {
  const voice = options.voice ? voiceSetup(scenario) : undefined;
  const Screen: LadleStoryComponent = () => {
    const routes: ReactNode = voice ? voice.wrap(h(StoryRoutes)) : h(StoryRoutes);
    const shell = h(SandboxShell, {
      path,
      voiceState: voice?.voiceState,
      isSocketConnected: options.isSocketConnected ?? true,
      overlay: h(
        Fragment,
        null,
        // App.tsx / AuthGate.tsx chrome, always mounted like in the real app.
        // (StartOffline must render before OfflineBanner reads navigator.onLine.)
        options.offline ? h(StartOffline) : null,
        h(ConnectionStatusBanner),
        // PWAInstallPrompt + UpdateToast + OfflineBanner, each behind its own
        // silent ErrorBoundary, exactly as App.tsx mounts them.
        h(AppChrome),
        options.updateAvailable ? h(SignalUpdateAvailable) : null,
        options.installPrompt ? h(FireInstallPrompt) : null,
        options.overlay ?? null,
      ),
      children: routes,
    });
    if (!options.theme) return shell;
    // Ladle paints its own light/dark `.ladle-background` layer (z-index
    // -1000) behind the story; with a story-chosen mode it shows through the
    // app's transparent panes instead of the app's own `body` background.
    return h(
      ThemeProvider,
      null,
      h(CssBaseline),
      h(GlobalStyles, { styles: { '.ladle-background': { display: 'none' } } }),
      shell,
    );
  };
  const extra = [...(options.extraHandlers ?? [])];
  if (options.theme) extra.push(appearanceHandler(scenario, options.theme));
  Screen.msw = makeHandlers(scenario, { extraHandlers: extra });
  return Screen;
}

// ── Scenario transforms for empty states ─────────────────────────────────

/** A community that exists but has no channels at all (fresh community, or all deleted). */
export function withNoChannels(scenario: Scenario, communityId: string): Scenario {
  const community = scenario.communities.find((c) => c.id === communityId);
  const removed = new Set((community?.channels ?? []).map((c) => c.id));
  const dropKeys = <T>(rec: Record<string, T>) =>
    Object.fromEntries(Object.entries(rec).filter(([k]) => !removed.has(k)));
  return {
    ...scenario,
    communities: scenario.communities.map((c) => (c.id === communityId ? { ...c, channels: [] } : c)),
    messagesByChannel: dropKeys(scenario.messagesByChannel),
    pinnedByChannel: dropKeys(scenario.pinnedByChannel),
    voicePresenceByChannel: dropKeys(scenario.voicePresenceByChannel),
    unreadByContextId: dropKeys(scenario.unreadByContextId),
  };
}

/** A community whose only member is `me` (nobody else joined yet). */
export function withSoloCommunity(scenario: Scenario, communityId: string): Scenario {
  const community = scenario.communities.find((c) => c.id === communityId)!;
  const voiceIds = new Set(community.channels.filter((c) => c.type === 'VOICE').map((c) => c.id));
  return {
    ...scenario,
    communities: scenario.communities.map((c) => (c.id === communityId ? { ...c, memberIds: [scenario.me.id] } : c)),
    membershipsByCommunity: {
      ...scenario.membershipsByCommunity,
      [communityId]: (scenario.membershipsByCommunity[communityId] ?? []).filter((m) => m.userId === scenario.me.id),
    },
    voicePresenceByChannel: Object.fromEntries(
      Object.entries(scenario.voicePresenceByChannel).filter(([k]) => !voiceIds.has(k)),
    ),
  };
}

/** Strip a user's optional profile fields (no display name, avatar, banner, bio or status). */
export function withBareUser(scenario: Scenario, userId: string): Scenario {
  const strip = <U extends Scenario['me']>(u: U): U =>
    u.id === userId ? { ...u, displayName: null, avatarUrl: null, bannerUrl: null, bio: null, status: null } : u;
  return { ...scenario, me: strip(scenario.me), users: scenario.users.map(strip) };
}

/**
 * No DM conversations at all. Unlike `withEmpty(s, 'dmGroups')` alone, this
 * also drops the DM ids from `unreadByContextId` — otherwise
 * `/api/read-receipts/unread-counts` keeps reporting unread DMs that no
 * longer exist and the Messages tab badge contradicts the empty list.
 */
export function withNoDms(scenario: Scenario): Scenario {
  const dmIds = new Set(scenario.dmGroups.map((g) => g.id));
  return {
    ...scenario,
    dmGroups: [],
    messagesByDmGroup: {},
    unreadByContextId: Object.fromEntries(Object.entries(scenario.unreadByContextId).filter(([k]) => !dmIds.has(k))),
  };
}

/** Drop every unread count (for scenarios whose channels/DMs were emptied upstream). */
export function withNoUnread(scenario: Scenario): Scenario {
  return { ...scenario, unreadByContextId: {} };
}
