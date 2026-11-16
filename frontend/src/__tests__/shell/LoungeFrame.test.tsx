/**
 * The Lounge frame (shell/lounge/frame/*): descriptors rendered into their template, the shell's
 * pieces kept mounted across screens, the Escape chain's panel step, route focus and announcements,
 * theme-color, the banner row, the notification sink, the shown-shell store and the socket.
 *
 * Real: LoungeRoot, the frame, the kit (KitProvider, AppFrame, ThreeIslands, the behaviour host),
 * NotificationProvider (renderWithProviders), ConnectionStatusBanner, IncomingCallProvider,
 * VoiceProvider. Fake: the user's appearance, the current user, the pieces (mount counters), the socket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode, useEffect, useMemo, type ReactNode } from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { renderWithProviders } from '../test-utils';
import { createMockSocket } from '../test-utils/mockSocket';
import { VoiceProvider } from '../../contexts/VoiceProvider';
import { RoomContext } from '../../contexts/RoomContextDef';
import { IncomingCallProvider } from '../../contexts/IncomingCallContext';
import { BottomChromeProvider } from '../../contexts/BottomChromeContext';
import { useNotification } from '../../contexts/NotificationContext';
import { VoiceActionType, useVoiceDispatch } from '../../contexts/VoiceContext';
import { SecureStorageWarning } from '../../components/Electron/SecureStorageWarning';
import { createFakeElectronAPI, emitOnSubscribe } from '../test-utils/fakeElectronAPI';
import { connectAppUpdates } from '../../data/appUpdate';
import { forgetAllAnnouncements } from '../../shell/bannerMemory';
import { ConnectionStatusBanner } from '../../components/ConnectionStatusBanner';
import { useThemeColorMeta } from '../../hooks/useThemeColorMeta';
import { derivePalette } from '../../theme/derive/derivePalette';
import { chooseShell } from '../../shell/chooseShell';
import { LOUNGE_ROUTES, type LoungeRoute } from '../../shell/loungeRoutes';
import { readShownShellKind } from '../../shell/shownShellKind';
import { useScreenChrome, type LoungeScreenProps, type ThreeIslandsScreen } from '../../shell/lounge/screen';
import { forgetRouteMemory, rememberActivatedRow } from '../../shell/routeMemory';
import LoungeRoot from '../../shell/lounge/LoungeRoot';

vi.mock('../../hooks/useAppearance', () => ({
  useAppearance: () => ({ baseColor: '#0d9488', mode: 'light', intensity: 'vibrant', newDesign: true }),
}));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'u1', username: 'alexk', displayName: 'Alex K' }, isLoading: false, isError: false }),
}));

/** Mounts of the shell's pieces: the frame must keep them across screens of one template. */
const pieces = vi.hoisted(() => ({ dock: 0, left: 0, members: 0, leftProps: [] as unknown[] }));
vi.mock('../../shell/lounge/pieces/ShellDock', async () => {
  const { useEffect: useMountEffect } = await import('react');
  const { useLoungeLinks } = await import('../../shell/lounge/links');
  return {
    ShellDockConnected: () => {
      useMountEffect(() => {
        pieces.dock += 1;
      }, []);
      // Where a dock item for community c-2 would lead (the frame's links context).
      const links = useLoungeLinks();
      return (
        <button type="button" data-community-href={links.community('c-2')}>
          Dock item
        </button>
      );
    },
  };
});
// The community fixture's centre and title read the community's name.
vi.mock('../../data/communities', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCommunity: (id: string) => ({ community: { id, name: `Community ${id}`, avatarFileId: null }, status: 'success', error: null, refetch: () => undefined }),
}));
vi.mock('../../shell/lounge/pieces/community/CommunityLeft', async () => {
  const { useEffect: useMountEffect } = await import('react');
  return {
    CommunityLeft: (props: { communityId: string; channelId: string | null }) => {
      pieces.leftProps.push(props);
      useMountEffect(() => {
        pieces.left += 1;
      }, []);
      return (
        <>
          <button type="button" data-lounge-row="ch-general">
            general
          </button>
          <button type="button" data-lounge-row="ch-random">
            random
          </button>
        </>
      );
    },
  };
});
// The user's card in the left island's footer (PR 6): its data is tested with the piece.
vi.mock('../../shell/lounge/pieces/community/UserCard', () => ({ UserCardConnected: () => null }));
vi.mock('../../shell/lounge/pieces/MembersIsland', async () => {
  const { useEffect: useMountEffect } = await import('react');
  return {
    MembersIslandConnected: ({ communityId }: { communityId: string }) => {
      useMountEffect(() => {
        pieces.members += 1;
      }, []);
      return <p>{`members of ${communityId}`}</p>;
    },
  };
});

// --- Fixture screens -----------------------------------------------------------

/** Renders of the screens' centres: the banner row's changes must not reach them (I6). */
const centreRenders = { count: 0 };

function HomeCentre({ params }: LoungeScreenProps) {
  centreRenders.count += 1;
  return <h1>{`Home of ${params.communityId}`}</h1>;
}

function ChannelCentre({ params }: LoungeScreenProps) {
  centreRenders.count += 1;
  const chrome = useScreenChrome();
  return (
    <>
      <h1>{`Channel ${params.channelId}`}</h1>
      <button type="button" onClick={() => chrome.setRightOpen(!chrome.rightOpen)}>
        Members
      </button>
    </>
  );
}

const homeScreen: ThreeIslandsScreen = {
  template: 'threeIslands',
  place: 'community',
  phonePane: 'centre',
  Centre: HomeCentre,
  right: 'members',
  useTitle: (params) => `Home of ${params.communityId}`,
};

const channelScreen: ThreeIslandsScreen = {
  template: 'threeIslands',
  place: 'community',
  phonePane: 'centre',
  Centre: ChannelCentre,
  right: 'members',
  useTitle: (params) => `Channel ${params.channelId}`,
};

const ALL: LoungeRoute['widths'] = ['phone', 'compact', 'wide'];
const ROUTES: LoungeRoute[] = [
  { path: '/fx/community/:communityId', widths: ALL, load: async () => ({ default: homeScreen }) },
  { path: '/fx/community/:communityId/channel/:channelId', widths: ALL, load: async () => ({ default: channelScreen }) },
  ...LOUNGE_ROUTES,
];

// --- The harness ---------------------------------------------------------------

const handles: {
  navigate?: ReturnType<typeof useNavigate>;
  show?: ReturnType<typeof useNotification>['showNotification'];
  voice?: ReturnType<typeof useVoiceDispatch>['dispatch'];
} = {};

function Handles() {
  handles.navigate = useNavigate();
  handles.show = useNotification().showNotification;
  handles.voice = useVoiceDispatch().dispatch;
  return null;
}

/** AppShell's switch, reduced: the new shell for a registered path, a stand-in for the old shell otherwise. */
function Switch() {
  const { pathname } = useLocation();
  const choice = useMemo(() => chooseShell({ pathname, enabled: true, width: 'wide', routes: ROUTES }), [pathname]);
  return choice.kind === 'lounge' ? <LoungeRoot choice={choice} /> : <div data-testid="classic-shell" />;
}

/** The old shell's theme asking for its theme-color, as ThemeContext does. */
function ClassicThemeColor({ color }: { color: string }) {
  useThemeColorMeta(color);
  return null;
}

function renderFrame(
  path: string,
  options: {
    socket?: ReturnType<typeof createMockSocket>;
    connected?: boolean;
    themeColor?: string;
    extra?: ReactNode;
    electron?: ReturnType<typeof createFakeElectronAPI>;
    strict?: boolean;
  } = {},
) {
  const wrap = (node: ReactNode) => (options.strict ? <StrictMode>{node}</StrictMode> : <>{node}</>);
  const tree = (themeColor: string) => wrap(
    <BottomChromeProvider>
      <VoiceProvider>
        <RoomContext.Provider value={{ room: null, setRoom: () => undefined, getRoom: () => null }}>
          <IncomingCallProvider>
            <Handles />
            <ClassicThemeColor color={themeColor} />
            {/* AuthGate's old-look chip, above AppShell in the app. */}
            <ConnectionStatusBanner />
            {options.extra}
            <Switch />
          </IncomingCallProvider>
        </RoomContext.Provider>
      </VoiceProvider>
    </BottomChromeProvider>,
  );
  const socket = options.socket ?? createMockSocket();
  const view = renderWithProviders(tree(options.themeColor ?? '#101010'), {
    routerProps: { initialEntries: [path] },
    socket,
    isSocketConnected: options.connected ?? true,
    electronAPI: options.electron,
  });
  return { ...view, socket, setThemeColor: (color: string) => view.rerender(tree(color)) };
}

async function go(path: string) {
  await act(async () => {
    await handles.navigate!(path);
  });
}

/** The page root's polite live region (kit announcer). */
function politeRegion(): HTMLElement {
  const region = document.body.querySelector<HTMLElement>('[data-kit-live-slot="root"] [aria-live="polite"]');
  if (region === null) throw new Error('no root live region');
  return region;
}

function themeColor(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;
}

const consoleError = vi.spyOn(console, 'error');

beforeEach(() => {
  pieces.dock = 0;
  pieces.left = 0;
  pieces.members = 0;
  pieces.leftProps.length = 0;
  forgetRouteMemory();
  forgetAllAnnouncements();
  centreRenders.count = 0;
  document.querySelector('meta[name="theme-color"]')?.remove();
  consoleError.mockClear();
});

afterEach(() => {
  // No React warning or error in any of these tests.
  expect(consoleError).not.toHaveBeenCalled();
});

describe('descriptors', () => {
  it('a bare descriptor (the marker) renders its body in the frame, and the shell says it is shown', async () => {
    expect(readShownShellKind()).toBe('classic');
    const { unmount } = renderFrame('/__lounge');
    expect(await screen.findByRole('heading', { name: 'New design preview' })).toBeInTheDocument();
    expect(readShownShellKind()).toBe('lounge');
    unmount();
    expect(readShownShellKind()).toBe('classic');
  });

  it('a three-islands descriptor renders the template: the left nav, the centre main with its title, the members aside', async () => {
    renderFrame('/fx/community/c-1');
    expect(await screen.findByRole('heading', { name: 'Home of c-1' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Community' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Home of c-1' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Members' })).toHaveTextContent('members of c-1');
    expect(pieces.leftProps[pieces.leftProps.length - 1]).toEqual({ communityId: 'c-1', channelId: null });
  });

  it('keeps the dock, the left island and the members mounted between two screens; only the centre changes', async () => {
    renderFrame('/fx/community/c-1');
    await screen.findByRole('heading', { name: 'Home of c-1' });
    const nav = screen.getByRole('navigation', { name: 'Community' });
    const general = screen.getByRole('button', { name: 'general' });

    await go('/fx/community/c-1/channel/ch-random');
    expect(await screen.findByRole('heading', { name: 'Channel ch-random' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Home of c-1' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Community' })).toBe(nav);
    expect(screen.getByRole('button', { name: 'general' })).toBe(general);
    expect(pieces.leftProps[pieces.leftProps.length - 1]).toEqual({ communityId: 'c-1', channelId: 'ch-random' });

    await go('/fx/community/c-1');
    await screen.findByRole('heading', { name: 'Home of c-1' });
    expect(pieces).toMatchObject({ dock: 1, left: 1, members: 1 });
  });

  it("the shell's community links are the app's routes, unless the descriptor (a fixture) sets its own", async () => {
    const fixtureLike: LoungeRoute = {
      path: '/fx/fixture/:communityId',
      widths: ALL,
      load: async () => ({ default: { ...homeScreen, links: { community: (id: string) => `#/fx/fixture/${id}` } } }),
    };
    ROUTES.unshift(fixtureLike);
    try {
      renderFrame('/fx/community/c-1');
      await screen.findByRole('heading', { name: 'Home of c-1' });
      expect(screen.getByRole('button', { name: 'Dock item' })).toHaveAttribute('data-community-href', '#/community/c-2');
      await go('/fx/fixture/c-1');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Dock item' })).toHaveAttribute('data-community-href', '#/fx/fixture/c-2'),
      );
    } finally {
      ROUTES.shift();
    }
  });

  it('the community fixture: every piece around a placeholder centre, and the pieces stay mounted from one community to the next', async () => {
    renderFrame('/__lounge/community/c-1');
    expect(await screen.findByRole('heading', { name: 'Community c-1', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('lounge-fixture-centre')).toHaveTextContent('Pick a channel or a room on the left.');
    expect(screen.getByRole('main', { name: 'Community c-1' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Community' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Members' })).toHaveTextContent('members of c-1');
    // The members show beside it at wide: no Members button.
    expect(screen.queryByRole('button', { name: 'Members' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dock item' })).toHaveAttribute('data-community-href', '#/__lounge/community/c-2');
    const nav = screen.getByRole('navigation', { name: 'Community' });

    await go('/__lounge/community/c-2');
    expect(await screen.findByRole('heading', { name: 'Community c-2', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Community' })).toBe(nav);
    expect(screen.getByRole('complementary', { name: 'Members' })).toHaveTextContent('members of c-2');
    expect(pieces.leftProps[pieces.leftProps.length - 1]).toEqual({ communityId: 'c-2', channelId: null });
    expect(pieces).toMatchObject({ dock: 1, left: 1, members: 1 });
  });

  it("a crash in a screen's centre stays in the centre: the dock and the left island stay", async () => {
    consoleError.mockImplementation(() => undefined);
    const Crashing = () => {
      throw new Error('centre crashed');
    };
    const crashing: LoungeRoute = {
      path: '/fx/community/:communityId',
      widths: ALL,
      load: async () => ({ default: { ...homeScreen, Centre: Crashing } }),
    };
    ROUTES.unshift(crashing);
    try {
      renderFrame('/fx/community/c-1');
      expect(await screen.findByRole('heading', { name: "Couldn't show this screen" })).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Community' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dock item' })).toBeInTheDocument();
    } finally {
      ROUTES.shift();
    }
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockReset();
  });
});

describe('the Escape chain', () => {
  it('closes the right island the user opened at wide; with the default untouched Escape does nothing', async () => {
    const { user } = renderFrame('/fx/community/c-1/channel/ch-1');
    await screen.findByRole('heading', { name: 'Channel ch-1' });
    // Default at wide: shown. Escape is not the screen's to use here.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('complementary', { name: 'Members' })).toBeInTheDocument();

    // The user closes it, then opens it again: now Escape closes it.
    await user.click(screen.getByRole('button', { name: 'Members' }));
    expect(screen.queryByRole('complementary', { name: 'Members' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Members' }));
    expect(screen.getByRole('complementary', { name: 'Members' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Members' })).toBeNull();
    // Escape never navigates.
    expect(screen.getByRole('heading', { name: 'Channel ch-1' })).toBeInTheDocument();
  });
});

describe('route focus', () => {
  it('moves focus to the new screen\'s heading and announces its title politely', async () => {
    renderFrame('/fx/community/c-1');
    await screen.findByRole('heading', { name: 'Home of c-1' });
    await waitFor(() => expect(politeRegion()).toHaveTextContent('Home of c-1'));

    await go('/fx/community/c-1/channel/ch-random');
    const heading = await screen.findByRole('heading', { name: 'Channel ch-random' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading.style.outline).toBe('none');
    await waitFor(() => expect(politeRegion()).toHaveTextContent('Channel ch-random'));
    // Never the previous screen's title for the new one.
    expect(politeRegion()).not.toHaveTextContent('Home of c-1');
  });

  it('keeps focus on a row of the left island when the user moves through it', async () => {
    renderFrame('/fx/community/c-1');
    await screen.findByRole('heading', { name: 'Home of c-1' });
    const random = screen.getByRole('button', { name: 'random' });
    act(() => random.focus());

    await go('/fx/community/c-1/channel/ch-random');
    await screen.findByRole('heading', { name: 'Channel ch-random' });
    expect(random).toHaveFocus();
    await waitFor(() => expect(politeRegion()).toHaveTextContent('Channel ch-random'));
  });

  it('on entry from the old shell, focus goes to the row the user last activated on that route', async () => {
    rememberActivatedRow('/fx/community/c-1', 'ch-random');
    renderFrame('/settings');
    expect(screen.getByTestId('classic-shell')).toBeInTheDocument();

    await go('/fx/community/c-1');
    await screen.findByRole('heading', { name: 'Home of c-1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'random' })).toHaveFocus());
  });

  it('a navigation while a dialog is open leaves focus in the dialog and announces nothing over it', async () => {
    renderFrame('/fx/community/c-1', {
      extra: (
        <div role="dialog" aria-modal="true" aria-label="Edit profile">
          <button type="button">Save profile</button>
        </div>
      ),
    });
    await screen.findByRole('heading', { name: 'Home of c-1' });
    await waitFor(() => expect(politeRegion()).toHaveTextContent('Home of c-1'));
    const save = screen.getByRole('button', { name: 'Save profile' });
    act(() => save.focus());

    await go('/fx/community/c-1/channel/ch-random');
    await screen.findByRole('heading', { name: 'Channel ch-random' });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(save).toHaveFocus();
    expect(politeRegion()).not.toHaveTextContent('Channel ch-random');
  });

  it('on entry with nothing remembered, focus goes to the heading (the marker)', async () => {
    renderFrame('/settings');
    await go('/__lounge');
    const heading = await screen.findByRole('heading', { name: 'New design preview' });
    await waitFor(() => expect(heading).toHaveFocus());
    await waitFor(() => expect(politeRegion()).toHaveTextContent('New design preview'));
  });
});

describe('theme-color', () => {
  it("paints the ground while the new shell is shown, survives a change of the old palette, and gives the old colour back", async () => {
    const ground = derivePalette('#0d9488', 'light', 'vibrant').ground;
    const view = renderFrame('/settings', { themeColor: '#101010' });
    expect(themeColor()).toBe('#101010');

    await go('/__lounge');
    await screen.findByRole('heading', { name: 'New design preview' });
    expect(themeColor()).toBe(ground);

    // The old theme changes colour (an appearance change) while the new shell is on screen.
    view.setThemeColor('#202020');
    expect(themeColor()).toBe(ground);

    await go('/settings');
    expect(screen.getByTestId('classic-shell')).toBeInTheDocument();
    expect(themeColor()).toBe('#202020');
  });
});

describe('the global chrome while the new shell is shown', () => {
  it('socket down at a Lounge route before the first connect: nothing for a moment, then "Connecting…", never the old chip', async () => {
    const { container } = renderFrame('/__lounge', { connected: false });
    await screen.findByRole('heading', { name: 'New design preview' });
    expect(screen.queryByRole('note')).toBeNull();
    expect(await screen.findByText('Connecting…', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Reconnecting...')).toBeNull();
    expect(container.querySelector('[class*="MuiChip"], [class*="MuiSnackbar"], [class*="MuiPaper"]')).toBeNull();
  });

  it('the browser offline at a Lounge route: "You\'re offline" at once', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      renderFrame('/__lounge');
      await screen.findByRole('heading', { name: 'New design preview' });
      expect(screen.getByRole('note')).toHaveTextContent("You're offline.");
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    }
  });

  it('offline at an old-shell route: the old chip, as before', () => {
    renderFrame('/settings', { connected: false });
    expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
    expect(screen.queryByText("You're offline. Reconnecting…")).toBeNull();
  });

  it('showNotification lands in the kit toast region and nowhere else, then in the old snackbar again', async () => {
    const { container } = renderFrame('/__lounge');
    await screen.findByRole('heading', { name: 'New design preview' });

    act(() => handles.show!('Profile saved', 'success'));
    const toast = await screen.findByText('Profile saved');
    expect(toast.closest('[data-kit-toast-region]')).not.toBeNull();
    // Once on screen (the toast host also reads it out through the live region, which is not a view).
    expect(screen.getAllByText('Profile saved').filter((el) => el.closest('[data-kit-live-slot]') === null)).toHaveLength(1);
    expect(document.querySelector('[class*="MuiSnackbar"]')).toBeNull();

    await go('/settings');
    act(() => handles.show!('Back in the old design', 'info'));
    const old = await screen.findByText('Back in the old design');
    expect(old.closest('[class*="MuiSnackbar"]')).not.toBeNull();
    expect(container.querySelector('[data-kit-toast-region]')).toBeNull();
  });

  it('adds no listener to the socket: the counts per event are the same as with the old shell', async () => {
    const socket = createMockSocket();
    const counts = () =>
      Object.fromEntries(
        [...new Set(socket.on.mock.calls.map(([event]) => event))].map((event) => [event, socket.getHandlers(event).length]),
      );
    renderFrame('/settings', { socket });
    const classic = counts();

    await go('/fx/community/c-1');
    await screen.findByRole('heading', { name: 'Home of c-1' });
    expect(counts()).toEqual(classic);
    await go('/__lounge');
    await screen.findByRole('heading', { name: 'New design preview' });
    expect(counts()).toEqual(classic);
  });
});

describe('the shown shell', () => {
  it('is published after the commit that shows the new shell, and is classic again when it goes', async () => {
    const seen: string[] = [];
    function Watch() {
      const { pathname } = useLocation();
      useEffect(() => {
        seen.push(`${pathname}:${readShownShellKind()}`);
      });
      return null;
    }
    renderWithProviders(
      <RoomContext.Provider value={{ room: null, setRoom: () => undefined, getRoom: () => null }}>
        <VoiceProvider>
          <IncomingCallProvider>
            <Handles />
            <Switch />
            <Watch />
          </IncomingCallProvider>
        </VoiceProvider>
      </RoomContext.Provider>,
      { routerProps: { initialEntries: ['/settings'] } },
    );
    expect(readShownShellKind()).toBe('classic');
    await go('/__lounge');
    await screen.findByRole('heading', { name: 'New design preview' });
    expect(readShownShellKind()).toBe('lounge');
    await go('/settings');
    expect(readShownShellKind()).toBe('classic');
    expect(seen).toContain('/__lounge:lounge');
    expect(seen[seen.length - 1]).toBe('/settings:classic');
  });
});

describe('a notice across a shell flip (I1)', () => {
  it('a notice showing in the old snackbar moves to a kit toast when the Lounge appears, shown once', async () => {
    renderFrame('/settings');
    act(() => handles.show!('Profile saved', 'success'));
    expect((await screen.findByText('Profile saved')).closest('[class*="MuiSnackbar"]')).not.toBeNull();

    await go('/__lounge');
    await screen.findByRole('heading', { name: 'New design preview' });
    const toast = await screen.findByText('Profile saved', { selector: '[data-kit-toast-region] *' });
    expect(toast).toBeInTheDocument();
    expect(document.querySelector('[class*="MuiSnackbar"]')).toBeNull();
    expect(screen.getAllByText('Profile saved').filter((el) => el.closest('[data-kit-live-slot]') === null)).toHaveLength(1);
  });

  it('a kit toast showing when the user leaves the Lounge moves to the old snackbar, not read out again', async () => {
    renderFrame('/__lounge');
    await screen.findByRole('heading', { name: 'New design preview' });
    act(() => handles.show!("Couldn't save your profile", 'error'));
    await screen.findByText("Couldn't save your profile", { selector: '[data-kit-toast-region] *' });

    await go('/settings');
    const old = await screen.findByText("Couldn't save your profile");
    const snackbarAlert = old.closest('[class*="MuiAlert-root"]');
    expect(snackbarAlert).not.toBeNull();
    // Already announced by the toast: shown, not spoken again.
    expect(snackbarAlert).toHaveAttribute('aria-live', 'off');
    expect(snackbarAlert).toHaveAttribute('role', 'status');
  });

  it('the secure-storage warning raised at sign-in shows on a Lounge start route', async () => {
    localStorage.setItem('semaphore:secureStorageWarningPending', 'true');
    renderFrame('/__lounge', { extra: <SecureStorageWarning />, electron: createFakeElectronAPI() });
    await screen.findByRole('heading', { name: 'New design preview' });
    expect(
      await screen.findByText(/Secure credential storage is unavailable/, { selector: '[data-kit-toast-region] *' }),
    ).toBeInTheDocument();
    localStorage.clear();
  });
});

describe('error boundaries reset on the path (I4)', () => {
  it('a crash in channel A is cleared when the user goes to channel B (same route pattern)', async () => {
    consoleError.mockImplementation(() => undefined);
    const Picky = ({ params }: LoungeScreenProps) => {
      if (params.channelId === 'a') throw new Error('bad data in channel a');
      return <h1>{`Channel ${params.channelId}`}</h1>;
    };
    const picky: LoungeRoute = {
      path: '/fx/community/:communityId/channel/:channelId',
      widths: ALL,
      load: async () => ({ default: { ...channelScreen, Centre: Picky } }),
    };
    ROUTES.unshift(picky);
    try {
      renderFrame('/fx/community/c-1/channel/a');
      expect(await screen.findByRole('heading', { name: "Couldn't show this screen" })).toBeInTheDocument();
      await go('/fx/community/c-1/channel/b');
      expect(await screen.findByRole('heading', { name: 'Channel b' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: "Couldn't show this screen" })).toBeNull();
    } finally {
      ROUTES.shift();
    }
    consoleError.mockReset();
  });
});

describe('the banner row does not re-render the screen (I6)', () => {
  it('a voice state change and update progress re-render zero screen components', async () => {
    let progress: (p: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void = () => undefined;
    renderFrame('/fx/community/c-1');
    await screen.findByRole('heading', { name: 'Home of c-1' });
    let disconnect = () => undefined as void;
    act(() => {
      disconnect = connectAppUpdates(
        createFakeElectronAPI({
          onUpdateAvailable: emitOnSubscribe({ version: '1.4.0' }),
          onDownloadProgress: (cb: typeof progress) => {
            progress = cb;
            return () => undefined;
          },
        }),
      );
    });
    const before = centreRenders.count;
    const leftBefore = pieces.leftProps.length;

    act(() => handles.voice!({ type: VoiceActionType.SetShowVideoTiles, payload: true }));
    act(() => handles.voice!({ type: VoiceActionType.SetDeafened, payload: true }));
    for (const percent of [10, 20, 30]) {
      act(() => progress({ percent, bytesPerSecond: 1, transferred: percent, total: 100 }));
    }
    expect(centreRenders.count).toBe(before);
    expect(pieces.leftProps.length).toBe(leftBefore);
    act(() => disconnect());
  });
});

describe('under StrictMode', () => {
  it('the shell is shown once mounted and classic after, and a notice still becomes one toast', async () => {
    const { unmount } = renderFrame('/__lounge', { strict: true });
    await screen.findByRole('heading', { name: 'New design preview' });
    expect(readShownShellKind()).toBe('lounge');
    act(() => handles.show!('Saved', 'success'));
    await screen.findByText('Saved', { selector: '[data-kit-toast-region] *' });
    expect(screen.getAllByText('Saved').filter((el) => el.closest('[data-kit-live-slot]') === null)).toHaveLength(1);
    unmount();
    expect(readShownShellKind()).toBe('classic');
  });
});
