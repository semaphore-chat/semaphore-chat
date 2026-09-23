/**
 * MobileScreenContainer keeps each tab's root screen (channel list, DM list,
 * notifications, profile) mounted but hidden while another screen is showing
 * (mobile UX overhaul, task 13), so switching tabs — or opening a chat and
 * coming back — keeps the list's scroll position instead of rebuilding it.
 * Detail screens (chat, DM chat, search...) still unmount when left.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { Routes, Route, useNavigate, type NavigateFunction } from 'react-router-dom';
import { renderWithProviders } from '../test-utils';
import { MobileScreenContainer } from '../../components/Mobile/Screens/MobileScreenContainer';
import { MobileNavigationProvider } from '../../components/Mobile/Navigation/MobileNavigationContext';

const chatMounts = vi.fn();

vi.mock('../../components/Mobile/Panels/MobileChannelsPanel', () => ({
  MobileChannelsPanel: ({ communityId }: { communityId: string }) => (
    <div data-testid={`channel-list-${communityId}`} style={{ overflowY: 'auto' }}>
      channels of {communityId}
    </div>
  ),
}));

vi.mock('../../components/Mobile/Panels/MobileMessagesPanel', () => ({
  MobileMessagesPanel: () => <div data-testid="dm-list">dm list</div>,
}));

vi.mock('../../components/Mobile/Panels/MobileChatPanel', async () => {
  const React = await import('react');
  return {
    MobileChatPanel: ({ channelId, dmGroupId }: { channelId?: string; dmGroupId?: string }) => {
      React.useEffect(() => {
        chatMounts();
      }, []);
      return <div data-testid={`chat-${channelId ?? dmGroupId}`}>chat</div>;
    },
  };
});

vi.mock('../../components/Mobile/Panels/MobileProfilePanel', () => ({
  MobileProfilePanel: () => <div data-testid="profile">profile</div>,
}));

vi.mock('../../components/Mobile/Screens/NotificationsScreen', () => ({
  NotificationsScreen: () => <div data-testid="notifications">notifications</div>,
}));

vi.mock('../../components/Mobile/Screens/MobileSearchScreen', () => ({
  MobileSearchScreen: () => <div data-testid="search">search</div>,
}));

let navigateRef: NavigateFunction | null = null;
function NavigateCapture() {
  navigateRef = useNavigate();
  return null;
}

function go(path: string) {
  act(() => {
    navigateRef!(path);
  });
}

function setup(initialPath: string) {
  return renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <MobileNavigationProvider>
            <NavigateCapture />
            <MobileScreenContainer />
          </MobileNavigationProvider>
        }
      />
    </Routes>,
    { routerProps: { initialEntries: [initialPath] } },
  );
}

/** The kept-alive wrapper around a screen. */
function screenLayer(el: HTMLElement): HTMLElement {
  const layer = el.closest('[data-screen-key]');
  if (!layer) throw new Error('screen is not inside a screen layer');
  return layer as HTMLElement;
}

describe('MobileScreenContainer — keep tab screens mounted', () => {
  it('keeps the channel list node and its scroll position across a tab switch', () => {
    setup('/community/c1');
    const list = screen.getByTestId('channel-list-c1');
    list.scrollTop = 420;

    go('/direct-messages');
    expect(screen.getByTestId('dm-list')).toBeInTheDocument();
    // Still mounted, but hidden from view and from assistive tech.
    expect(screen.getByTestId('channel-list-c1')).toBe(list);
    expect(screenLayer(list)).toHaveAttribute('aria-hidden', 'true');
    expect(screenLayer(list)).toHaveAttribute('inert');

    go('/community/c1');
    const again = screen.getByTestId('channel-list-c1');
    expect(again).toBe(list);
    expect(again.scrollTop).toBe(420);
    expect(screenLayer(again)).not.toHaveAttribute('aria-hidden');
    expect(screenLayer(again)).not.toHaveAttribute('inert');
    // The DM list is now the hidden one.
    expect(screenLayer(screen.getByTestId('dm-list'))).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the channel list under an open chat and returns to the same node', () => {
    setup('/community/c1');
    const list = screen.getByTestId('channel-list-c1');
    list.scrollTop = 250;

    go('/community/c1/channel/ch1');
    expect(screen.getByTestId('chat-ch1')).toBeInTheDocument();
    expect(screenLayer(list)).toHaveAttribute('aria-hidden', 'true');

    go('/community/c1');
    expect(screen.getByTestId('channel-list-c1')).toBe(list);
    expect(list.scrollTop).toBe(250);
  });

  it('unmounts detail screens when they are left', () => {
    chatMounts.mockClear();
    setup('/community/c1/channel/ch1');
    expect(screen.getByTestId('chat-ch1')).toBeInTheDocument();

    go('/direct-messages');
    expect(screen.queryByTestId('chat-ch1')).not.toBeInTheDocument();

    go('/community/c1/channel/ch1');
    expect(screen.getByTestId('chat-ch1')).toBeInTheDocument();
    expect(chatMounts).toHaveBeenCalledTimes(2);
  });

  it('keeps only one root screen per tab (switching community replaces it)', () => {
    setup('/community/c1');
    go('/community/c2');
    expect(screen.queryByTestId('channel-list-c1')).not.toBeInTheDocument();
    expect(screen.getByTestId('channel-list-c2')).toBeInTheDocument();
  });

  it('shows exactly one visible screen at a time', () => {
    setup('/community/c1');
    go('/direct-messages');
    go('/notifications');
    go('/profile');

    const layers = Array.from(document.querySelectorAll('[data-screen-key]'));
    expect(layers).toHaveLength(4);
    const visible = layers.filter((l) => !l.hasAttribute('aria-hidden'));
    expect(visible).toHaveLength(1);
    expect(visible[0]).toContainElement(screen.getByTestId('profile'));
  });
});
