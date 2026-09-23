/**
 * Back closes the members / pinned drawers in the mobile chat panel before it
 * leaves the chat screen (Review Focus #5).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import { renderWithProviders, createChannel } from '../test-utils';
import { MobileChatPanel } from '../../components/Mobile/Panels/MobileChatPanel';
import { TOUCH_TARGETS } from '../../utils/breakpoints';

const goBack = vi.hoisted(() => vi.fn());

vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({ goBack, navigateToSearch: vi.fn() }),
}));
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ shouldUseTouchUI: true, isMobile: true }),
}));
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: { isConnected: false, currentChannelId: null } }),
}));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', username: 'me' } }),
}));
vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  channelsControllerFindOneOptions: () => ({
    queryKey: ['channel', 'ch1'],
    queryFn: async () => createChannel({ id: 'ch1', communityId: 'c1', name: 'general' }),
  }),
  directMessagesControllerFindDmGroupOptions: () => ({ queryKey: ['dm', ''], enabled: false }),
  moderationControllerGetPinnedMessagesOptions: () => ({ queryKey: ['pinned', ''], queryFn: async () => [] }),
}));
vi.mock('../../components/Channel/ChannelMessageContainer', () => ({
  default: () => <div data-testid="channel-message-container" />,
}));
vi.mock('../../components/DirectMessages/DirectMessageContainer', () => ({
  default: () => <div data-testid="direct-message-container" />,
}));
vi.mock('../../components/Mobile/MobileAppBar', () => ({
  default: (props: {
    onMembersClick?: () => void;
    onMoreClick?: (e: React.MouseEvent<HTMLElement>) => void;
    actions?: React.ReactNode;
  }) => (
    <div data-testid="mobile-app-bar">
      <button onClick={props.onMembersClick}>members</button>
      <button onClick={props.onMoreClick}>more</button>
      {props.actions}
    </div>
  ),
}));
vi.mock('../../components/Message/MemberListContainer', () => ({
  default: () => <div data-testid="member-list" />,
}));
vi.mock('../../components/Moderation', () => ({
  PinnedMessagesPanel: () => <div data-testid="pinned-panel" />,
}));

const drawerOpen = (el: HTMLElement | null) => {
  const modal = el?.closest('.MuiModal-root');
  return !!modal && !modal.className.includes('MuiModal-hidden');
};

const overlayDepth = () =>
  ((window.history.state as Record<string, unknown> | null)?.__overlayStack as unknown[] | undefined)?.length ?? 0;

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('MobileChatPanel overlays and back', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    while ((window.history.state as Record<string, unknown> | null)?.__overlayStack) {
      window.history.back();
      await flush();
    }
  });

  it('back closes the members drawer without leaving the chat', async () => {
    const { user } = renderWithProviders(<MobileChatPanel communityId="c1" channelId="ch1" />);

    await user.click(screen.getByRole('button', { name: 'members' }));
    expect(drawerOpen(screen.getByText('Members'))).toBe(true);
    expect(overlayDepth()).toBe(1);

    act(() => window.history.back());

    await waitFor(() => expect(drawerOpen(screen.getByText('Members'))).toBe(false));
    expect(goBack).not.toHaveBeenCalled();
  });

  it('the members close button is a 44px touch target', async () => {
    const { user } = renderWithProviders(<MobileChatPanel communityId="c1" channelId="ch1" />);
    await user.click(screen.getByRole('button', { name: 'members' }));
    expect(screen.getByRole('button', { name: 'Close members' })).toHaveStyle({
      minWidth: `${TOUCH_TARGETS.MINIMUM}px`,
      minHeight: `${TOUCH_TARGETS.MINIMUM}px`,
    });
  });

  it('back closes the pinned drawer', async () => {
    const { user } = renderWithProviders(<MobileChatPanel communityId="c1" channelId="ch1" />);
    await user.click(screen.getByRole('button', { name: 'more' }));
    await user.click(await screen.findByText('Pinned Messages'));
    const panel = await screen.findByTestId('pinned-panel');
    expect(drawerOpen(panel)).toBe(true);

    act(() => window.history.back());

    await waitFor(() => expect(screen.queryByTestId('pinned-panel')).toSatisfy(
      (el: HTMLElement | null) => !drawerOpen(el),
    ));
    expect(goBack).not.toHaveBeenCalled();
  });
});
