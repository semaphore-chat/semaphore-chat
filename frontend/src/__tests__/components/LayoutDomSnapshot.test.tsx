/**
 * The DOM the app shell renders with no call in progress, at phone, tablet and
 * desktop widths, for a handful of routes.
 *
 * Written before the voice plumbing moved out of the three layouts into the
 * shared VoiceSessionLayer (Layout.tsx). That move must not change what the
 * layouts render, so these snapshots must stay as they were committed.
 *
 * The layouts, their voice pieces and the providers are real. Leaf UI that the
 * move does not touch (rail, drawers, screens, sidebars, bottom nav) is a
 * marker element, so the snapshot shows the layout structure and nothing that
 * loads data.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderWithProviders } from '../test-utils';
import { BottomChromeProvider } from '../../contexts/BottomChromeContext';
import { VoiceProvider } from '../../contexts/VoiceProvider';
import { RoomContext } from '../../contexts/RoomContextDef';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isElectron: () => false,
  isWeb: () => true,
}));

// No call in progress.
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: {
      isConnected: false,
      isConnecting: false,
      currentChannelId: null,
      currentDmGroupId: null,
      showVideoTiles: false,
      room: null,
    },
    actions: { joinDmVoice: vi.fn(), joinVoiceChannel: vi.fn(), endVoiceSession: vi.fn(), setShowVideoTiles: vi.fn() },
  }),
}));

vi.mock('../../hooks/useSocket', () => ({
  useSocket: vi.fn(() => null),
  useSocketConnected: () => false,
}));

// Layout's own hooks and providers render no DOM of their own.
vi.mock('../../hooks/useVoiceRecovery', () => ({ useVoiceRecovery: vi.fn() }));
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

// Leaf UI: markers.
vi.mock('../../components/CommunityList/CommunityToggle', () => ({
  default: ({ isExpanded, voiceConnected }: { isExpanded: boolean; voiceConnected: boolean }) => (
    <div data-testid="rail" data-expanded={String(isExpanded)} data-voice={String(voiceConnected)} />
  ),
}));
vi.mock('../../components/Notifications/NotificationCenter', () => ({
  default: ({ open }: { open: boolean }) => <div data-testid="notification-center" data-open={String(open)} />,
}));
vi.mock('../../components/Mobile/Navigation/MobileCommunityDrawer', () => ({
  default: () => <div data-testid="drawer" />,
}));
vi.mock('../../components/Mobile/Screens/MobileScreenContainer', () => ({
  MobileScreenContainer: () => <div data-testid="mobile-screen" />,
}));
vi.mock('../../components/Mobile/Navigation/MobileBottomNavigation', () => ({
  MobileBottomNavigation: ({ hideOnDetailScreens }: { hideOnDetailScreens?: boolean }) => (
    <div data-testid="bottom-nav" data-hide-on-detail={String(!!hideOnDetailScreens)} />
  ),
}));
vi.mock('../../components/Mobile/Tablet/TabletSidebar', () => ({
  TabletSidebar: ({ communityId }: { communityId: string | null }) => (
    <div data-testid="tablet-sidebar" data-community={String(communityId)} />
  ),
}));
vi.mock('../../components/Mobile/Tablet/TabletContentArea', () => ({
  TabletContentArea: ({ showSidebar }: { showSidebar: boolean }) => (
    <div data-testid="tablet-content" data-show-sidebar={String(showSidebar)} />
  ),
}));

import Layout from '../../Layout';

/** matchMedia that evaluates min-/max-width queries against `width`. */
function stubViewportWidth(width: number) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const max = /max-width:\s*(\d+)px/.exec(query);
      const matches =
        (min || max) && !query.includes('pointer') && !query.includes('hover')
          ? (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
          : false;
      return {
        matches: !!matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  );
}

const roomContext = { room: null, setRoom: vi.fn(), getRoom: () => null };

afterEach(() => {
  vi.unstubAllGlobals();
});

const WIDTHS = [
  ['phone', 390],
  ['tablet', 820],
  ['desktop', 1440],
] as const;

const ROUTES = ['/', '/community/c-1/channel/ch-1', '/direct-messages', '/settings', '/admin'];

describe.each(WIDTHS)('Layout DOM, no call, %s (%dpx)', (_name, width) => {
  it.each(ROUTES)('%s', (route) => {
    stubViewportWidth(width);
    const { asFragment } = renderWithProviders(
      <BottomChromeProvider>
        <VoiceProvider>
          <RoomContext.Provider value={roomContext}>
            <Layout />
          </RoomContext.Provider>
        </VoiceProvider>
      </BottomChromeProvider>,
      { routerProps: { initialEntries: [route] } },
    );
    expect(asFragment()).toMatchSnapshot();
  });
});
