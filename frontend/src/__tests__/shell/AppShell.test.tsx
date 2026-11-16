/**
 * The shell switch (shell/AppShell.tsx): with the new design off nothing of
 * the new shell is ever loaded; with it on, only registered routes show the
 * new shell; and whichever way the switch goes (the setting, this tab's
 * preview, a navigation, a width change, a crash or a slow chunk) the call
 * underneath is never touched.
 *
 * Real: AppShell, ClassicShell, the three layouts, VoiceSessionLayer,
 * TrackSubscriptionProvider, AudioRenderer, VoiceProvider, the app's
 * ThemeProvider, the chooser and the preview store. Fake: the LiveKit Room,
 * leaf UI (markers), the new shell's chunk (a stub whose factory records that
 * it was loaded) and VoiceSessionEffects (mount counters).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { Suspense } from 'react';
import { act, screen, fireEvent } from '@testing-library/react';
import { Route, Routes, matchRoutes, createRoutesFromChildren, useNavigate, type RouteObject } from 'react-router-dom';
import type { Room } from 'livekit-client';
import { renderWithProviders } from '../test-utils';
import { BottomChromeProvider } from '../../contexts/BottomChromeContext';
import { VoiceProvider } from '../../contexts/VoiceProvider';
import { RoomContext } from '../../contexts/RoomContextDef';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { ThemeProvider, useTheme } from '../../contexts/ThemeContext';
import { STORAGE_KEY } from '../../theme/constants';
import { ErrorBoundary } from '../../components/ErrorBoundary';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const platform = vi.hoisted(() => ({ electron: false }));
vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isElectron: () => platform.electron,
  isWeb: () => !platform.electron,
}));

vi.mock('../../hooks/useSocket', () => ({
  useSocket: vi.fn(() => null),
  useSocketConnected: () => false,
}));

const counts = vi.hoisted(() => ({ recoveryMounts: 0, effectsMounts: 0, effectsUnmounts: 0 }));
/** The new shell's chunk: `loaded` counts requests for it; `mode` says what the stub screen does. */
const lounge = vi.hoisted(() => ({
  loaded: 0,
  /** How many of the next loads fail like a chunk that is gone (a deploy) or offline. */
  failLoads: 0,
  mode: 'ok' as 'ok' | 'throw' | 'suspend',
  never: new Promise<never>(() => {}),
}));

// The new shell's chunk is reached only through loadLoungeRoot (shell/loungeRootChunk.ts),
// so counting its calls proves the chunk is never even requested. The stub
// suspends by throwing a promise that never settles.
vi.mock('../../shell/loungeRootChunk', () => {
  const StubLoungeRoot = ({ choice }: { choice: { route: { path: string } } }) => {
    if (lounge.mode === 'throw') throw new Error('lounge screen crashed');
    if (lounge.mode === 'suspend') throw lounge.never;
    return <div data-shell="lounge" data-route={choice.route.path} />;
  };
  return {
    loadLoungeRoot: () => {
      lounge.loaded += 1;
      if (lounge.failLoads > 0) {
        lounge.failLoads -= 1;
        return Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/LoungeRoot-x.js'));
      }
      return Promise.resolve({ default: StubLoungeRoot });
    },
  };
});

vi.mock('../../hooks/useVoiceRecovery', async () => {
  const { useEffect: useMountEffect } = await import('react');
  return {
    useVoiceRecovery: () => {
      useMountEffect(() => {
        counts.recoveryMounts += 1;
      }, []);
    },
  };
});
vi.mock('../../components/Voice/VoiceSessionEffects', async () => {
  const { useEffect: useMountEffect } = await import('react');
  const FakeVoiceSessionEffects = () => {
    useMountEffect(() => {
      counts.effectsMounts += 1;
      return () => {
        counts.effectsUnmounts += 1;
      };
    }, []);
    return null;
  };
  return { default: FakeVoiceSessionEffects };
});
vi.mock('../../components/Voice/VoiceBottomBarContent', () => ({
  default: () => <div data-testid="voice-bar-content" />,
}));

vi.mock('../../hooks/useVoiceForegroundResync', () => ({ useVoiceForegroundResync: vi.fn() }));
vi.mock('../../hooks/useThemeSync', () => ({ useThemeSync: vi.fn() }));
vi.mock('../../hooks/useAppBadge', () => ({ useAppBadge: vi.fn() }));
vi.mock('../../hooks/usePushResync', () => ({ usePushResync: vi.fn() }));
vi.mock('../../hooks/useDesktopSignInNotice', () => ({ useDesktopSignInNotice: vi.fn() }));
vi.mock('../../components/LayoutProviders', () => ({
  LayoutProviders: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: undefined, isLoading: false, isError: false }),
}));

vi.mock('../../components/CommunityList/CommunityToggle', () => ({
  default: () => <div data-testid="rail" />,
}));
vi.mock('../../components/Notifications/NotificationCenter', () => ({ default: () => null }));
vi.mock('../../components/Mobile/Navigation/MobileCommunityDrawer', () => ({ default: () => null }));
vi.mock('../../components/Mobile/Screens/MobileScreenContainer', () => ({
  MobileScreenContainer: () => <div data-testid="mobile-screen" />,
}));
vi.mock('../../components/Mobile/Navigation/MobileBottomNavigation', () => ({
  MobileBottomNavigation: () => null,
}));
vi.mock('../../components/Mobile/Tablet/TabletSidebar', () => ({ TabletSidebar: () => null }));
vi.mock('../../components/Mobile/Tablet/TabletContentArea', () => ({
  TabletContentArea: () => <div data-testid="tablet-content" />,
}));

import AppShell from '../../shell/AppShell';
import { AppRoutes } from '../../routes';
import { DesignPreviewPage } from '../../pages/debug/PWADebugPage';
import { clearDesignPreview, setDesignPreview } from '../../shell/designPreview';
import { renewLoungeRoot } from '../../shell/loungeRootLazy';
import { COMMUNITY_HOME_PATH, LOUNGE_ROUTES, loungeCommunityFixturePath } from '../../shell/loungeRoutes';
import { readShownShellKind } from '../../shell/shownShellKind';

// --- A viewport whose width can change, with real media-query listeners ------

interface FakeMediaQueryList {
  media: string;
  matches: boolean;
  listeners: Set<(e: { matches: boolean }) => void>;
}

function evaluate(query: string, width: number): boolean {
  if (query.includes('pointer') || query.includes('hover') || query.includes('prefers-')) return false;
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  if (!min && !max) return false;
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
}

function createViewport(initialWidth: number) {
  let width = initialWidth;
  const lists: FakeMediaQueryList[] = [];
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const list: FakeMediaQueryList = { media: query, matches: evaluate(query, width), listeners: new Set() };
      lists.push(list);
      return {
        get matches() {
          return list.matches;
        },
        media: query,
        onchange: null,
        addListener: (l: (e: { matches: boolean }) => void) => list.listeners.add(l),
        removeListener: (l: (e: { matches: boolean }) => void) => list.listeners.delete(l),
        addEventListener: (_: string, l: (e: { matches: boolean }) => void) => list.listeners.add(l),
        removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => list.listeners.delete(l),
        dispatchEvent: vi.fn(),
      };
    }),
  );
  return {
    setWidth(next: number) {
      width = next;
      for (const list of lists) {
        const matches = evaluate(list.media, width);
        if (matches === list.matches) continue;
        list.matches = matches;
        list.listeners.forEach((l) => l({ matches }));
      }
    },
  };
}

// --- A fake Room with one remote participant speaking ------------------------

type Listener = (...args: unknown[]) => void;

class FakeEmitter {
  private listeners = new Map<string, Set<Listener>>();
  on(event: string, l: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(l);
    return this;
  }
  off(event: string, l: Listener) {
    this.listeners.get(event)?.delete(l);
    return this;
  }
}

function createRoom() {
  const track = {
    kind: 'audio',
    mediaStreamTrack: { enabled: true },
    attach: vi.fn((el: HTMLMediaElement) => el),
    detach: vi.fn((el?: HTMLMediaElement) => el),
    setVolume: vi.fn(),
    getVolume: vi.fn(() => 1),
  };
  const micPublication = {
    source: 'microphone',
    trackSid: 'TR_alice_mic',
    trackName: 'microphone',
    kind: 'audio',
    isSubscribed: true,
    isMuted: false,
    track,
    setSubscribed: vi.fn(),
  };
  const alice = Object.assign(new FakeEmitter(), {
    identity: 'alice',
    name: 'Alice',
    trackPublications: new Map([[micPublication.trackSid, micPublication]]),
    audioTrackPublications: new Map([[micPublication.trackSid, micPublication]]),
  });
  const room = Object.assign(new FakeEmitter(), {
    state: 'connected',
    remoteParticipants: new Map([['alice', alice]]),
    disconnect: vi.fn(),
    localParticipant: Object.assign(new FakeEmitter(), {
      identity: 'me',
      trackPublications: new Map(),
      isMicrophoneEnabled: true,
      setMicrophoneEnabled: vi.fn(async () => undefined),
    }),
  });
  return { room, track };
}

const IN_A_CALL = {
  isConnected: true,
  contextType: VoiceSessionType.Channel,
  currentChannelId: 'ch-1',
  channelName: 'general',
  communityId: 'c-1',
  isPrivate: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** Handles on the router and the theme from inside the tree. */
const handles: { navigate?: ReturnType<typeof useNavigate>; setNewDesign?: (on: boolean) => void } = {};

/** App's top-level Suspense fallback: counts how often it is shown (it hides, and cleans up, the whole signed-in tree). */
const appSuspended = { shown: 0 };
function AppSuspended() {
  React.useEffect(() => {
    appSuspended.shown += 1;
  }, []);
  return <div data-testid="app-suspended" />;
}

/** An old-shell page that is still a lazy chunk the first time it renders, like NotFoundPage. */
let slowPage = React.lazy(() => new Promise<{ default: React.FC }>(() => {}));
function renewSlowPage() {
  slowPage = React.lazy(
    () => new Promise<{ default: React.FC }>((resolve) => setTimeout(() => resolve({ default: () => <div data-testid="page" /> }), 30)),
  );
}
function Handles() {
  handles.navigate = useNavigate();
  handles.setNewDesign = useTheme().setNewDesign;
  return null;
}

interface RenderOptions {
  route?: string;
  inCall?: boolean;
  /** Render AppShell inside real routes (its Outlet then shows the page). */
  withRoutes?: boolean;
  /** With routes: the `*` page is a lazy chunk not loaded yet. */
  slowPageRoute?: boolean;
}

function renderShell({
  route = '/community/c-1/channel/ch-1',
  inCall = true,
  withRoutes = false,
  slowPageRoute = false,
  entries,
}: RenderOptions & { entries?: string[] } = {}) {
  const { room, track } = createRoom();
  const setRoom = vi.fn();
  const roomContext = inCall
    ? { room: room as unknown as Room, setRoom, getRoom: () => room as unknown as Room }
    : { room: null, setRoom, getRoom: () => null };
  const shell = withRoutes ? (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route path="debug/design" element={<DesignPreviewPage />} />
        <Route index element={slowPageRoute ? React.createElement(slowPage) : <div data-testid="page" />} />
        <Route path="*" element={slowPageRoute ? React.createElement(slowPage) : <div data-testid="page" />} />
      </Route>
    </Routes>
  ) : (
    <AppShell />
  );
  const view = renderWithProviders(
    // Anything reaching these would mean the switch's own boundaries failed.
    <ErrorBoundary fallback={<div data-testid="app-crashed" />}>
      <Suspense fallback={<AppSuspended />}>
        <ThemeProvider>
          <BottomChromeProvider>
            <VoiceProvider initialState={inCall ? IN_A_CALL : undefined}>
              <RoomContext.Provider value={roomContext}>
                <Handles />
                {shell}
              </RoomContext.Provider>
            </VoiceProvider>
          </BottomChromeProvider>
        </ThemeProvider>
      </Suspense>
    </ErrorBoundary>,
    { routerProps: entries ? { initialEntries: entries, initialIndex: entries.length - 1 } : { initialEntries: [route] } },
  );
  return { ...view, room, track, setRoom };
}

/** Lets lazy chunks and effects settle. */
async function flush() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setNewDesignStored(on: boolean) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ newDesign: on }));
}

const loungeShell = (container: HTMLElement) => container.querySelector('[data-shell="lounge"]');
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  counts.recoveryMounts = 0;
  counts.effectsMounts = 0;
  counts.effectsUnmounts = 0;
  lounge.mode = 'ok';
  lounge.failLoads = 0;
  platform.electron = false;
  appSuspended.shown = 0;
  localStorage.clear();
  clearDesignPreview();
  getUserMedia = vi.fn(async () => ({}));
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('with the new design off', () => {
  it.each([
    [390, 'mobile-screen'],
    [820, 'tablet-content'],
    [1440, 'rail'],
  ] as const)('shows the old shell at %d px, on the marker and the community fixture too, and never loads the new shell', async (width, marker) => {
    createViewport(width);
    lounge.loaded = 0;
    for (const route of ['/', '/__lounge', loungeCommunityFixturePath('c-1'), '/settings']) {
      const { container, unmount } = renderShell({ route, inCall: false });
      await flush();
      expect(screen.getByTestId(marker)).toBeInTheDocument();
      expect(loungeShell(container)).toBeNull();
      unmount();
    }
    expect(lounge.loaded).toBe(0);
  });

  it('a preview set to classic keeps the old shell even when the account has the new design on', async () => {
    createViewport(1440);
    setNewDesignStored(true);
    setDesignPreview('classic');
    const { container } = renderShell({ route: '/__lounge', inCall: false });
    await flush();
    expect(screen.getByTestId('rail')).toBeInTheDocument();
    expect(loungeShell(container)).toBeNull();
  });
});

describe('with the new design on', () => {
  it('an unconverted route is still the old shell', async () => {
    createViewport(1440);
    setNewDesignStored(true);
    const { container } = renderShell({ route: '/settings', inCall: false });
    await flush();
    expect(screen.getByTestId('rail')).toBeInTheDocument();
    expect(loungeShell(container)).toBeNull();
  });

  it.each([390, 820, 1440])('the marker route is the new shell at %d px, with no old-shell shortcuts', async (width) => {
    createViewport(width);
    setNewDesignStored(true);
    const { container } = renderShell({ route: '/__lounge', inCall: false });
    await flush();
    expect(loungeShell(container)).toHaveAttribute('data-route', '/__lounge');
    expect(screen.queryByTestId('rail')).toBeNull();
    expect(screen.queryByTestId('mobile-screen')).toBeNull();
    expect(screen.queryByTestId('tablet-content')).toBeNull();
    // ShortcutsProvider (Escape marks read, Alt+arrows) lives in the old desktop layout only.
    expect(screen.queryByTestId('shortcut-announcer')).toBeNull();
  });

  it('a ?design=lounge link shows the new shell on its first render, before App removes the parameter', async () => {
    createViewport(1440);
    const { container } = renderShell({ route: '/__lounge?design=lounge', inCall: false });
    await flush();
    expect(loungeShell(container)).not.toBeNull();
  });

  it("loads the current route's screen ahead of time too (M6), only for a registered route, never with the setting off", async () => {
    createViewport(1440);
    const marker = LOUNGE_ROUTES[0];
    // A stub: the real screen module would pull the kit in after the test environment is gone (D8).
    const load = vi.spyOn(marker, 'load').mockResolvedValue({
      default: { template: 'bare', Body: () => null, useTitle: () => null },
    });

    const off = renderShell({ route: '/__lounge', inCall: false });
    await flush();
    expect(load).not.toHaveBeenCalled();
    off.unmount();

    setNewDesignStored(true);
    const unconverted = renderShell({ route: '/settings', inCall: false });
    await flush();
    expect(load).not.toHaveBeenCalled();
    act(() => handles.navigate!('/__lounge'));
    await flush();
    expect(load).toHaveBeenCalled();
    unconverted.unmount();
  });

  it('the old shell also loads the new shell ahead of time once the new design is on', async () => {
    createViewport(1440);
    lounge.loaded = 0;
    setNewDesignStored(true);
    renderShell({ route: '/settings', inCall: false });
    await flush();
    expect(lounge.loaded).toBeGreaterThan(0);
  });
});

describe('the phone community home (/community/:communityId)', () => {
  /** A stub for the real screen module: it would pull the kit in after the test environment is gone (D8). */
  function stubHomeLoad() {
    const home = LOUNGE_ROUTES.find((route) => route.path === COMMUNITY_HOME_PATH)!;
    return vi.spyOn(home, 'load').mockResolvedValue({
      default: { template: 'bare', Body: () => null, useTitle: () => null },
    });
  }

  it('a phone at /community/:id with the setting on shows the Lounge home; the setting off shows classic', async () => {
    stubHomeLoad();
    createViewport(390);
    const off = renderShell({ route: '/community/c-1', inCall: false });
    await flush();
    expect(loungeShell(off.container)).toBeNull();
    expect(screen.getByTestId('mobile-screen')).toBeInTheDocument();
    off.unmount();

    setNewDesignStored(true);
    const on = renderShell({ route: '/community/c-1', inCall: false });
    await flush();
    expect(loungeShell(on.container)).toHaveAttribute('data-route', COMMUNITY_HOME_PATH);
    expect(screen.queryByTestId('mobile-screen')).toBeNull();
  });

  it.each([820, 1440])('at %d px the real path stays classic with the setting on', async (width) => {
    stubHomeLoad();
    createViewport(width);
    setNewDesignStored(true);
    const { container } = renderShell({ route: '/community/c-1', inCall: false });
    await flush();
    expect(loungeShell(container)).toBeNull();
  });

  it('/community/create at phone with the setting on is the old shell', async () => {
    const load = stubHomeLoad();
    createViewport(390);
    setNewDesignStored(true);
    const { container } = renderShell({ route: '/community/create', inCall: false });
    await flush();
    expect(loungeShell(container)).toBeNull();
    expect(screen.getByTestId('mobile-screen')).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });

  it('Electron at phone width is classic, and loads no screen ahead of time; the fixtures still show', async () => {
    const load = stubHomeLoad();
    platform.electron = true;
    createViewport(390);
    setNewDesignStored(true);
    const real = renderShell({ route: '/community/c-1', inCall: false });
    await flush();
    expect(loungeShell(real.container)).toBeNull();
    // The old shell in the desktop app is its desktop layout at every width.
    expect(screen.getByTestId('rail')).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
    real.unmount();

    const fixture = renderShell({ route: '/__lounge', inCall: false });
    await flush();
    expect(loungeShell(fixture.container)).not.toBeNull();
  });

  it('a channel tap shows the classic chat, and phone → compact → phone mid-call swaps shells as deferred renders; the call stays', async () => {
    stubHomeLoad();
    const viewport = createViewport(390);
    setNewDesignStored(true);
    const { container } = renderShell({ route: '/community/c-1' });
    await flush();
    expect(loungeShell(container)).not.toBeNull();
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    const expectCallUp = (step: string) => {
      expect(container.querySelector('audio'), step).toBe(audio);
      expect(counts.effectsMounts, step).toBe(1);
      expect(counts.effectsUnmounts, step).toBe(0);
      expect(screen.queryByTestId('app-suspended'), step).toBeNull();
      expect(screen.queryByTestId('app-crashed'), step).toBeNull();
    };

    act(() => handles.navigate!('/community/c-1/channel/ch-1'));
    await flush();
    expect(loungeShell(container)).toBeNull();
    expect(screen.getByTestId('mobile-screen')).toBeInTheDocument();
    expectCallUp('the classic chat');

    act(() => handles.navigate!(-1));
    await flush();
    expect(loungeShell(container)).not.toBeNull();
    expectCallUp('Back to the Lounge home');

    act(() => viewport.setWidth(820));
    await flush();
    expect(loungeShell(container)).toBeNull();
    expect(screen.getByTestId('tablet-content')).toBeInTheDocument();
    expectCallUp('compact');

    act(() => viewport.setWidth(390));
    await flush();
    expectCallUp('back to phone');
    expect(appSuspended.shown).toBe(0);
  });
});

describe('the call across a change of shell', () => {
  it('keeps the Room, the mic and the same <audio> element through the setting, the preview, navigation and width', async () => {
    const viewport = createViewport(1440);
    const { container, room, track, setRoom } = renderShell();
    await flush();
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(screen.getByTestId('rail')).toBeInTheDocument();

    const expectCallUntouched = (step: string) => {
      expect(container.querySelectorAll('audio'), step).toHaveLength(1);
      expect(container.querySelector('audio'), step).toBe(audio);
      expect(track.attach, step).toHaveBeenCalledTimes(1);
      expect(track.detach, step).not.toHaveBeenCalled();
      expect(room.localParticipant.setMicrophoneEnabled, step).not.toHaveBeenCalled();
      expect(room.disconnect, step).not.toHaveBeenCalled();
      expect(setRoom, step).not.toHaveBeenCalled();
      expect(getUserMedia, step).not.toHaveBeenCalled();
      expect(counts.effectsMounts, step).toBe(1);
      expect(counts.effectsUnmounts, step).toBe(0);
      expect(counts.recoveryMounts, step).toBe(1);
      expect(screen.queryByTestId('app-crashed'), step).toBeNull();
      expect(screen.queryByTestId('app-suspended'), step).toBeNull();
    };

    // Navigation to the marker with the setting off: old shell.
    act(() => handles.navigate!('/__lounge'));
    await flush();
    expect(loungeShell(container)).toBeNull();
    expectCallUntouched('marker, setting off');

    // The tab's preview: new shell.
    act(() => setDesignPreview('lounge'));
    await flush();
    expect(loungeShell(container)).not.toBeNull();
    expectCallUntouched('preview on');

    // Width: the marker is converted at every width.
    for (const width of [820, 390, 1440]) {
      act(() => viewport.setWidth(width));
      await flush();
      expect(loungeShell(container), `${width}px`).not.toBeNull();
      expectCallUntouched(`${width}px`);
    }

    // Navigation away: old shell.
    act(() => handles.navigate!('/community/c-1/channel/ch-1'));
    await flush();
    expect(loungeShell(container)).toBeNull();
    expect(screen.getByTestId('rail')).toBeInTheDocument();
    expectCallUntouched('back to a channel');

    // The account setting, with no preview.
    act(() => clearDesignPreview());
    act(() => handles.setNewDesign!(true));
    act(() => handles.navigate!('/__lounge'));
    await flush();
    expect(loungeShell(container)).not.toBeNull();
    act(() => handles.setNewDesign!(false));
    await flush();
    expect(loungeShell(container)).toBeNull();
    act(() => handles.setNewDesign!(true));
    await flush();
    expect(loungeShell(container)).not.toBeNull();
    expectCallUntouched('setting flipped three times');
  });

  it('a crash in the new shell shows its own error page, without Reload, and keeps the call up', async () => {
    createViewport(1440);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    lounge.mode = 'throw';
    setNewDesignStored(true);
    const { container, track, room } = renderShell({ route: '/__lounge' });
    await flush();
    expect(screen.getByText('The new design could not be shown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to the current design' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    expect(screen.queryByTestId('app-crashed')).toBeNull();
    expect(container.querySelectorAll('audio')).toHaveLength(1);
    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(track.detach).not.toHaveBeenCalled();
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(counts.effectsUnmounts).toBe(0);
    expect(consoleError).toHaveBeenCalled();
  });

  it('a chunk that fails to load: "Back to the current design" shows the old shell with the same call, no reload', async () => {
    createViewport(1440);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location);
    lounge.failLoads = Number.POSITIVE_INFINITY;
    renewLoungeRoot(); // a first load in this page, not the one earlier tests resolved
    setDesignPreview('lounge');
    const { container, track, room } = renderShell({ route: '/__lounge' });
    await flush();
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(screen.getByText('The new design could not be shown')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to the current design' }));
    await flush();
    expect(screen.getByTestId('rail')).toBeInTheDocument();
    expect(loungeShell(container)).toBeNull();
    expect(screen.queryByText('The new design could not be shown')).toBeNull();
    expect(container.querySelector('audio')).toBe(audio);
    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(track.detach).not.toHaveBeenCalled();
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(counts.effectsMounts).toBe(1);
    expect(counts.effectsUnmounts).toBe(0);
    expect(reload).not.toHaveBeenCalled();
    // This tab is back on the current design: the marker is the old shell's 404 now.
    act(() => handles.navigate!('/__lounge'));
    await flush();
    expect(screen.queryByText('The new design could not be shown')).toBeNull();
    expect(screen.getByTestId('rail')).toBeInTheDocument();
    expect(lounge.loaded).toBeGreaterThan(0);
    expect(consoleError).toHaveBeenCalled();
  });

  it('a chunk that keeps failing: "Try again" shows the page again, then "Back" keeps the call', async () => {
    createViewport(1440);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lounge.failLoads = Number.POSITIVE_INFINITY;
    renewLoungeRoot();
    setDesignPreview('lounge');
    const { container, track, room } = renderShell({ route: '/__lounge' });
    await flush();
    const audio = container.querySelector('audio');
    expect(screen.getByText('The new design could not be shown')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(screen.getByText('The new design could not be shown')).toBeInTheDocument();
    expect(screen.queryByTestId('app-crashed')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back to the current design' }));
    await flush();
    expect(screen.getByTestId('rail')).toBeInTheDocument();
    expect(screen.queryByTestId('app-crashed')).toBeNull();
    expect(container.querySelector('audio')).toBe(audio);
    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(track.detach).not.toHaveBeenCalled();
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(counts.effectsMounts).toBe(1);
    expect(counts.effectsUnmounts).toBe(0);
  });

  it('"Back" while the old shell\'s page is still a lazy chunk never suspends the whole app (the call stays mounted)', async () => {
    createViewport(1440);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lounge.failLoads = Number.POSITIVE_INFINITY;
    renewLoungeRoot();
    renewSlowPage();
    setDesignPreview('lounge');
    const { container, track, room } = renderShell({ route: '/__lounge', withRoutes: true, slowPageRoute: true });
    await flush();
    const audio = container.querySelector('audio');
    expect(screen.getByText('The new design could not be shown')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to the current design' }));
    expect(await screen.findByTestId('page')).toBeInTheDocument();
    expect(screen.getByTestId('rail')).toBeInTheDocument();
    expect(appSuspended.shown).toBe(0);
    expect(container.querySelector('audio')).toBe(audio);
    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(track.detach).not.toHaveBeenCalled();
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(counts.effectsMounts).toBe(1);
    expect(counts.effectsUnmounts).toBe(0);
  });

  it('the account setting turned off on the marker while the old page is a lazy chunk never suspends the whole app', async () => {
    createViewport(1440);
    renewSlowPage();
    setNewDesignStored(true);
    const { container, track, room } = renderShell({ route: '/__lounge', withRoutes: true, slowPageRoute: true });
    await flush();
    expect(loungeShell(container)).not.toBeNull();
    const audio = container.querySelector('audio');

    // A plain setState, as when the server's settings arrive with the setting off.
    act(() => handles.setNewDesign!(false));
    expect(await screen.findByTestId('page')).toBeInTheDocument();
    expect(loungeShell(container)).toBeNull();
    expect(appSuspended.shown).toBe(0);
    expect(container.querySelector('audio')).toBe(audio);
    expect(track.detach).not.toHaveBeenCalled();
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(counts.effectsUnmounts).toBe(0);
  });

  it('a chunk that fails once: "Try again" loads it, with the same call', async () => {
    createViewport(1440);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lounge.failLoads = 1;
    renewLoungeRoot();
    setNewDesignStored(true);
    const { container, track } = renderShell({ route: '/__lounge' });
    await flush();
    const audio = container.querySelector('audio');
    expect(screen.getByText('The new design could not be shown')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(loungeShell(container)).not.toBeNull();
    expect(screen.queryByText('The new design could not be shown')).toBeNull();
    expect(container.querySelector('audio')).toBe(audio);
    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(counts.effectsUnmounts).toBe(0);
  });

  it('a new shell that is still loading shows the spinner and keeps the call up', async () => {
    createViewport(1440);
    lounge.mode = 'suspend';
    setNewDesignStored(true);
    const { container, track } = renderShell({ route: '/__lounge' });
    await flush();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByTestId('app-suspended')).toBeNull();
    // The old-look spinner is on screen: the global chrome must not yield to a shell that is not shown.
    expect(readShownShellKind()).toBe('classic');
    const audio = container.querySelector('audio');
    if (audio === null) throw new Error(container.innerHTML);
    expect(audio.isConnected).toBe(true);
    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(counts.effectsMounts).toBe(1);
    expect(counts.effectsUnmounts).toBe(0);
  });
});

describe('history POP across the two shells (the phone Back, design risk 3)', () => {
  it('Back from a lazy old-shell page to a new-design route never shows App\'s fallback, and keeps the call', async () => {
    // Desktop: the harness's phone layout stubs out the page (MobileScreenContainer).
    createViewport(1440);
    renewSlowPage();
    setDesignPreview('lounge');
    // The user was on the marker, tapped into an old-shell page (a lazy chunk), and goes Back.
    const { container, track, room } = renderShell({ withRoutes: true, slowPageRoute: true, entries: ['/__lounge', '/settings'] });
    expect(await screen.findByTestId('page')).toBeInTheDocument();
    await flush();
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    // The first render of a lazy page on a cold start suspends to App's fallback; that is page load, not a flip.
    appSuspended.shown = 0;

    act(() => handles.navigate!(-1));
    await flush();
    expect(loungeShell(container)).not.toBeNull();
    expect(appSuspended.shown).toBe(0);
    expect(container.querySelector('audio')).toBe(audio);
    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(track.detach).not.toHaveBeenCalled();
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(counts.effectsMounts).toBe(1);
    expect(counts.effectsUnmounts).toBe(0);
  });

  it('Back from a new-design route to an old-shell page that is still a lazy chunk never shows App\'s fallback', async () => {
    // Desktop: the harness's phone layout stubs out the page (MobileScreenContainer).
    createViewport(1440);
    renewSlowPage();
    setDesignPreview('lounge');
    const { container, track, room } = renderShell({ withRoutes: true, slowPageRoute: true, entries: ['/settings', '/__lounge'] });
    await flush();
    expect(loungeShell(container)).not.toBeNull();
    const audio = container.querySelector('audio');

    act(() => handles.navigate!(-1));
    expect(await screen.findByTestId('page')).toBeInTheDocument();
    expect(loungeShell(container)).toBeNull();
    expect(appSuspended.shown).toBe(0);
    expect(container.querySelector('audio')).toBe(audio);
    expect(track.detach).not.toHaveBeenCalled();
    expect(room.disconnect).not.toHaveBeenCalled();
    expect(counts.effectsUnmounts).toBe(0);
  });
});

describe('the design preview page (/debug/design)', () => {
  it('lives inside the app shell in routes.tsx, unlike /debug/pwa', () => {
    const element = AppRoutes({}) as React.ReactElement<{ children: React.ReactNode }>;
    const table: RouteObject[] = createRoutesFromChildren(element.props.children);
    const underShell = (path: string) =>
      (matchRoutes(table, path) ?? []).some((match) => (match.route.element as React.ReactElement | undefined)?.type === AppShell);
    expect(underShell('/debug/design')).toBe(true);
    expect(underShell('/debug/pwa')).toBe(false);
  });

  it('turning the new design on there mid-call saves it and keeps the call', async () => {
    createViewport(1440);
    const { container, track, room } = renderShell({ route: '/debug/design', withRoutes: true });
    await flush();
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();

    const toggle = await screen.findByLabelText('New design (saved to your account)');
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await flush();
    expect(toggle).toBeChecked();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').newDesign).toBe(true);

    act(() => handles.navigate!('/__lounge'));
    await flush();
    expect(loungeShell(container)).not.toBeNull();
    expect(container.querySelector('audio')).toBe(audio);
    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(track.detach).not.toHaveBeenCalled();
    expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(counts.effectsMounts).toBe(1);
    expect(counts.effectsUnmounts).toBe(0);
  });
});
