/**
 * Task 17 — tablet layout (mobile UX overhaul).
 *
 * - Tablet navigates with the sidebar only: no bottom nav on any screen, and
 *   the sidebar (with its Home / Messages / Notifications / Profile header)
 *   is visible on every screen, with or without a community.
 * - No back button in tablet chat (the sidebar is always visible).
 * - Below 1024px the member list is not an inline third column; it opens as
 *   an overlay from the app bar's members button.
 * - Electron / desktop width keeps the inline member list (Review Focus #1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderWithProviders } from '../test-utils';
import { renderInEveryTheme } from '../test-utils/themeMatrix';
import { createTestQueryClient } from '../test-utils/queryClient';

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

const nav = vi.hoisted(() => ({
  currentScreen: 'channels' as string,
  communityId: 'c-1' as string | null,
  lastCommunityId: null as string | null,
  channelId: null as string | null,
  dmGroupId: null as string | null,
  activeTab: 'home' as string,
  setActiveTab: vi.fn(),
  openDrawer: vi.fn(),
  navigateToChat: vi.fn(),
  goBack: vi.fn(),
  navigateToSearch: vi.fn(),
}));
vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  MobileNavigationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMobileNavigation: () => ({
    activeTab: nav.activeTab,
    lastCommunityId: nav.lastCommunityId,
    setActiveTab: nav.setActiveTab,
    openDrawer: nav.openDrawer,
    navigateToChat: nav.navigateToChat,
    goBack: nav.goBack,
    navigateToSearch: nav.navigateToSearch,
    state: {
      currentScreen: nav.currentScreen,
      communityId: nav.communityId,
      channelId: nav.channelId,
      dmGroupId: nav.dmGroupId,
    },
  }),
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: false, isConnecting: false, currentChannelId: null, currentDmGroupId: null, room: null },
    actions: { joinDmVoice: vi.fn(), joinVoiceChannel: vi.fn() },
  }),
}));
vi.mock('../../hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({
    totalDmUnreadCount: 7,
    unreadCount: () => 0,
    mentionCount: () => 0,
    hasUnread: () => false,
    lastReadMessageId: () => undefined,
    allUnreadCounts: [],
  }),
}));
vi.mock('../../hooks/useSocket', () => ({
  useSocket: vi.fn(() => null),
  useSocketConnected: () => false,
}));
vi.mock('../../hooks/useVoiceRecovery', () => ({ useVoiceRecovery: vi.fn() }));
vi.mock('../../components/Voice/AudioRenderer', () => ({ AudioRenderer: () => null }));
vi.mock('../../components/Voice/PersistentVideoOverlay', () => ({ PersistentVideoOverlay: () => null }));
vi.mock('../../components/Voice/VoiceBottomBar', () => ({ VoiceBottomBar: () => null }));
vi.mock('../../components/Voice/TrackSubscriptionProvider', () => ({
  TrackSubscriptionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../hooks/useVoiceEventLog', () => ({
  VoiceEventLogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../components/Mobile/Navigation/MobileCommunityDrawer', () => ({ default: () => null }));

// The channel list and community header are covered by
// CommunityChannelsPanels.test.tsx; stub them here.
vi.mock('../../components/Channel/ChannelCategoryList', () => ({
  default: () => <div data-testid="channel-list" />,
}));
vi.mock('../../components/Mobile/CommunityHeader', () => ({
  default: () => <div data-testid="community-header" />,
}));

// TabletContentArea's screens.
const chatPanelProps = vi.fn();
vi.mock('../../components/Mobile/Panels/MobileChatPanel', () => ({
  MobileChatPanel: (props: Record<string, unknown>) => {
    chatPanelProps(props);
    return <div data-testid="chat-panel" />;
  },
}));
vi.mock('../../components/Mobile/Panels/MobileMessagesPanel', () => ({
  MobileMessagesPanel: () => <div data-testid="dm-list" />,
}));
vi.mock('../../components/Mobile/Panels/MobileProfilePanel', () => ({
  MobileProfilePanel: () => <div data-testid="profile" />,
}));
vi.mock('../../components/Mobile/Screens/NotificationsScreen', () => ({
  NotificationsScreen: () => <div data-testid="notifications" />,
}));
vi.mock('../../components/Mobile/Screens/MobileSearchScreen', () => ({
  MobileSearchScreen: () => <div data-testid="search" />,
}));
vi.mock('../../pages/SettingsPage', () => ({ default: () => <div data-testid="settings" /> }));

import { TabletLayout } from '../../components/Mobile/Tablet/TabletLayout';
import { TabletContentArea } from '../../components/Mobile/Tablet/TabletContentArea';
import { TabletNavHeader } from '../../components/Mobile/Tablet/TabletNavHeader';
import { BottomChromeProvider } from '../../contexts/BottomChromeContext';
import { TOUCH_TARGETS } from '../../utils/breakpoints';

const inStore = (ui: React.ReactNode) => renderWithProviders(<BottomChromeProvider>{ui}</BottomChromeProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  platform.electron = false;
  nav.currentScreen = 'channels';
  nav.communityId = 'c-1';
  nav.lastCommunityId = null;
  nav.channelId = null;
  nav.dmGroupId = null;
  nav.activeTab = 'home';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TabletLayout: sidebar navigation only', () => {
  it.each(['channels', 'chat', 'dm-list', 'dm-chat', 'notifications', 'profile'])(
    'has no bottom nav and shows the sidebar on the %s screen',
    (currentScreen) => {
      nav.currentScreen = currentScreen;
      nav.channelId = currentScreen === 'chat' ? 'ch-1' : null;
      nav.dmGroupId = currentScreen === 'dm-chat' ? 'dm-1' : null;
      inStore(<TabletLayout />);

      // The phone's BottomNavigation is gone…
      expect(document.querySelector('.MuiBottomNavigation-root')).toBeNull();
      // …and the sidebar with its nav header is there instead.
      const sidebar = screen.getByTestId('tablet-sidebar');
      expect(within(sidebar).getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    },
  );

  it('keeps the sidebar (and its nav) when no community is selected', () => {
    nav.communityId = null;
    inStore(<TabletLayout />);
    const sidebar = screen.getByTestId('tablet-sidebar');
    expect(within(sidebar).getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(within(sidebar).queryByTestId('channel-list')).not.toBeInTheDocument();
  });

  it('keeps showing the last community on screens without one (DMs)', () => {
    nav.currentScreen = 'dm-list';
    nav.communityId = null;
    nav.lastCommunityId = 'c-9';
    inStore(<TabletLayout />);
    const sidebar = screen.getByTestId('tablet-sidebar');
    expect(within(sidebar).getByTestId('channel-list')).toBeInTheDocument();
    expect(screen.getByTestId('dm-list')).toBeInTheDocument();
  });

  it('shows the community header and channel list when a community is selected', () => {
    inStore(<TabletLayout />);
    const sidebar = screen.getByTestId('tablet-sidebar');
    expect(within(sidebar).getByTestId('community-header')).toBeInTheDocument();
    expect(within(sidebar).getByTestId('channel-list')).toBeInTheDocument();
  });

  it('gives dedicated pages (admin, community settings, profile edit) the full width: no sidebar', () => {
    nav.currentScreen = 'route';
    nav.communityId = null;
    nav.lastCommunityId = 'c-9';
    inStore(<TabletLayout />);
    expect(screen.queryByTestId('tablet-sidebar')).not.toBeInTheDocument();
    // The page keeps its back button to return to the app.
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
  });

  it('an Electron window at tablet width also drops the sidebar on dedicated pages', () => {
    platform.electron = true;
    nav.currentScreen = 'route';
    inStore(<TabletLayout />);
    expect(screen.queryByTestId('tablet-sidebar')).not.toBeInTheDocument();
  });

  it('a narrow Electron window on the tablet layout gets no bottom nav either', () => {
    platform.electron = true;
    nav.currentScreen = 'chat';
    nav.channelId = 'ch-1';
    inStore(<TabletLayout />);
    expect(document.querySelector('.MuiBottomNavigation-root')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });
});

describe('TabletNavHeader', () => {
  it('has Home, Messages, Notifications and Profile entry points at touch size', () => {
    inStore(<TabletNavHeader />);
    for (const name of [/home/i, /messages/i, /notifications/i, /profile/i]) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeInTheDocument();
      expect(getComputedStyle(button).minWidth).toBe(`${TOUCH_TARGETS.MINIMUM}px`);
      expect(getComputedStyle(button).minHeight).toBe(`${TOUCH_TARGETS.MINIMUM}px`);
    }
  });

  it('switches tabs', async () => {
    const { user } = inStore(<TabletNavHeader />);
    await user.click(screen.getByRole('button', { name: /messages/i }));
    expect(nav.setActiveTab).toHaveBeenCalledWith('messages');
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(nav.setActiveTab).toHaveBeenCalledWith('notifications');
    await user.click(screen.getByRole('button', { name: /profile/i }));
    expect(nav.setActiveTab).toHaveBeenCalledWith('profile');
    await user.click(screen.getByRole('button', { name: /home/i }));
    expect(nav.setActiveTab).toHaveBeenCalledWith('home');
  });

  it('marks the active tab and shows the DM unread badge', () => {
    nav.activeTab = 'messages';
    inStore(<TabletNavHeader />);
    const messages = screen.getByRole('button', { name: /messages/i });
    expect(messages).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /home/i })).not.toHaveAttribute('aria-current');
    expect(messages).toHaveTextContent('7');
  });

  it('renders in every theme (Review Focus #2)', () => {
    renderInEveryTheme(
      () => (
        <QueryClientProvider client={createTestQueryClient()}>
          <TabletNavHeader />
        </QueryClientProvider>
      ),
      (result) => {
        expect(result.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
      },
    );
  });
});

describe('TabletContentArea: no back button when the sidebar is visible', () => {
  it('renders channel chat without a back button', () => {
    nav.currentScreen = 'chat';
    nav.channelId = 'ch-1';
    inStore(<TabletContentArea showSidebar />);
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(chatPanelProps).toHaveBeenLastCalledWith(expect.objectContaining({ hideBack: true }));
  });

  it('renders DM chat without a back button', () => {
    nav.currentScreen = 'dm-chat';
    nav.dmGroupId = 'dm-1';
    inStore(<TabletContentArea showSidebar />);
    expect(chatPanelProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ dmGroupId: 'dm-1', hideBack: true }),
    );
  });

  it('points at the sidebar when no community is selected', () => {
    nav.communityId = null;
    inStore(<TabletContentArea showSidebar />);
    expect(screen.getByText(/no community selected/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open community menu' })).not.toBeInTheDocument();
  });
});
