/**
 * Route -> bottom-tab mapping on the touch layouts. The active tab is derived
 * from the URL (parseScreenFromPath + getTabFromScreen), so every route has to
 * land on the tab the user reached it from. Friends lives in the Messages area
 * (the DM page's "Friends" tab; picking a friend opens a DM), so /friends
 * highlights Messages, not Home.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { renderWithProviders } from '../test-utils';
import {
  MobileNavigationProvider,
  getTabFromScreen,
  parseScreenFromPath,
  useMobileNavigation,
  type MobileTab,
} from '../../components/Mobile/Navigation/MobileNavigationContext';
import { MobileBottomNavigation } from '../../components/Mobile/Navigation/MobileBottomNavigation';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({ totalDmUnreadCount: 0 }),
}));

const tabFor = (pathname: string) => getTabFromScreen(parseScreenFromPath(pathname).screen, pathname);

describe('getTabFromScreen (route -> tab)', () => {
  const cases: Array<{ pathname: string; tab: MobileTab | null }> = [
    // Home: communities and their channels
    { pathname: '/', tab: 'home' },
    { pathname: '/community/c1', tab: 'home' },
    { pathname: '/community/c1/channel/ch1', tab: 'home' },
    { pathname: '/community/c1/channel/ch1/search', tab: 'home' },
    { pathname: '/community/create', tab: 'home' },
    { pathname: '/community/c1/edit', tab: 'home' },
    // Messages: DMs and friends
    { pathname: '/direct-messages', tab: 'messages' },
    { pathname: '/direct-messages/dm1', tab: 'messages' },
    { pathname: '/friends', tab: 'messages' },
    { pathname: '/friends/', tab: 'messages' },
    // Notifications
    { pathname: '/notifications', tab: 'notifications' },
    // Profile: own profile, its edit form and settings
    { pathname: '/profile', tab: 'profile' },
    { pathname: '/profile/edit', tab: 'profile' },
    { pathname: '/settings', tab: 'profile' },
    { pathname: '/settings/voice', tab: 'profile' },
    // Someone else's profile has no tab of its own (keeps the previous one)
    { pathname: '/profile/other-user', tab: null },
    // Everything else still falls back to Home
    { pathname: '/admin', tab: 'home' },
    { pathname: '/something/unknown', tab: 'home' },
    // A path that only starts with "friends" is not the Friends page
    { pathname: '/friendship', tab: 'home' },
  ];

  it.each(cases)('$pathname -> $tab', ({ pathname, tab }) => {
    expect(tabFor(pathname)).toBe(tab);
  });
});

let navigateTo: (path: string) => void = () => {};
const NavigateHandle = () => {
  const navigate = useNavigate();
  navigateTo = (path) => navigate(path);
  return null;
};

const TabProbe = () => {
  const { activeTab } = useMobileNavigation();
  return <div data-testid="active-tab">{activeTab}</div>;
};

function renderNav(path: string) {
  return renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <MobileNavigationProvider>
            <NavigateHandle />
            <TabProbe />
            <MobileBottomNavigation />
          </MobileNavigationProvider>
        }
      />
    </Routes>,
    { routerProps: { initialEntries: [path] } },
  );
}

const tabButton = (label: string) => screen.getByRole('button', { name: new RegExp(label) });

describe('MobileBottomNavigation on the Friends page', () => {
  it('highlights Messages, not Home, on /friends', () => {
    renderNav('/friends');

    expect(screen.getByTestId('active-tab')).toHaveTextContent('messages');
    expect(tabButton('Messages')).toHaveClass('Mui-selected');
    expect(tabButton('Home')).not.toHaveClass('Mui-selected');
  });

  it('moves the highlight from Home to Messages when navigating to /friends', () => {
    renderNav('/community/c1');
    expect(tabButton('Home')).toHaveClass('Mui-selected');

    act(() => navigateTo('/friends'));

    expect(tabButton('Messages')).toHaveClass('Mui-selected');
    expect(tabButton('Home')).not.toHaveClass('Mui-selected');
  });

  it("keeps Messages highlighted on a friend's profile opened from /friends", () => {
    renderNav('/community/c1');
    act(() => navigateTo('/friends'));
    act(() => navigateTo('/profile/some-friend'));

    expect(screen.getByTestId('active-tab')).toHaveTextContent('messages');
    expect(tabButton('Messages')).toHaveClass('Mui-selected');
  });
});
