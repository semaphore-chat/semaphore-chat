import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { MobileChatPanel } from '../../components/Mobile/Panels/MobileChatPanel';
import { isSwipeExemptTarget } from '../../utils/swipeExempt';
import { MOBILE_CONSTANTS } from '../../utils/breakpoints';

// Stable goBack mock so we can assert it was invoked.
const goBack = vi.hoisted(() => vi.fn());

vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({ goBack }),
}));

// Force touch UI on so the swipe handlers are wired. Mocked as a vi.fn so
// individual tests can override the returned device type (phone vs tablet).
// Note: vi.clearAllMocks() does NOT reset a mockReturnValue, so the phone
// default is re-asserted explicitly in beforeEach.
const { mockUseResponsive } = vi.hoisted(() => ({
  mockUseResponsive: vi.fn(() => ({ shouldUseTouchUI: true, isMobile: true })),
}));

vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: mockUseResponsive,
}));

// Capture the options passed to useSwipeGesture so we can drive the callbacks
// directly. The real hook's gesture detection is covered by useSwipeGesture.test.ts.
type SwipeOpts = Parameters<typeof import('../../hooks/useSwipeGesture').useSwipeGesture>[0];
const captured: { opts: SwipeOpts | null } = vi.hoisted(() => ({ opts: null }));

vi.mock('../../hooks/useSwipeGesture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useSwipeGesture')>();
  return {
    ...actual,
    useSwipeGesture: (opts: SwipeOpts) => {
      captured.opts = opts;
      return {
        onTouchStart: vi.fn(),
        onTouchMove: vi.fn(),
        onTouchEnd: vi.fn(),
        getSwipeState: vi.fn(),
      };
    },
  };
});

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: false, currentChannelId: null },
  }),
}));

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', username: 'me' } }),
}));

vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  channelsControllerFindOneOptions: () => ({ queryKey: ['channel', ''], enabled: false }),
  directMessagesControllerFindDmGroupOptions: () => ({ queryKey: ['dm', ''], enabled: false }),
  moderationControllerGetPinnedMessagesOptions: () => ({ queryKey: ['pinned', ''], enabled: false }),
}));

vi.mock('../../components/Channel/ChannelMessageContainer', () => ({
  default: () => <div data-testid="channel-message-container" />,
}));

vi.mock('../../components/DirectMessages/DirectMessageContainer', () => ({
  default: () => <div data-testid="direct-message-container" />,
}));

vi.mock('../../components/Mobile/MobileAppBar', () => ({
  default: () => <div data-testid="mobile-app-bar" />,
}));

vi.mock('../../components/Message/MemberListContainer', () => ({
  default: () => <div data-testid="member-list" />,
}));

vi.mock('../../components/Moderation', () => ({
  PinnedMessagesPanel: () => <div data-testid="pinned-panel" />,
}));

/**
 * The member SwipeableDrawer keeps its content mounted, so "open" is detected by
 * the absence of the `MuiModal-hidden` class on its modal root (closed drawers
 * carry that class + aria-hidden).
 */
const membersDrawerOpen = () => {
  const modal = screen.getByText('Members').closest('.MuiModal-root');
  return !!modal && !modal.className.includes('MuiModal-hidden');
};

describe('MobileChatPanel swipe navigation wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.opts = null;
    mockUseResponsive.mockReturnValue({ shouldUseTouchUI: true, isMobile: true });
  });

  it('configures the swipe hook with edge/exempt/direction guards', () => {
    renderWithProviders(<MobileChatPanel communityId="c1" channelId="ch1" />);

    expect(captured.opts).toBeTruthy();
    expect(captured.opts?.enabled).toBe(true);
    expect(captured.opts?.ignoreEdgeSwipes).toBe(true);
    expect(captured.opts?.edgeZone).toBe(MOBILE_CONSTANTS.EDGE_BACK_GESTURE_ZONE);
    expect(captured.opts?.directionRatio).toBeGreaterThan(1);
    expect(captured.opts?.isExempt).toBe(isSwipeExemptTarget);
  });

  it('swipe right invokes goBack on phone', () => {
    mockUseResponsive.mockReturnValue({ shouldUseTouchUI: true, isMobile: true });
    renderWithProviders(<MobileChatPanel communityId="c1" channelId="ch1" />);

    act(() => captured.opts?.onSwipeRight?.(1));

    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('swipe right does not invoke goBack on tablet (split-view already shows the list)', () => {
    mockUseResponsive.mockReturnValue({ shouldUseTouchUI: true, isMobile: false });
    renderWithProviders(<MobileChatPanel communityId="c1" channelId="ch1" />);

    act(() => captured.opts?.onSwipeRight?.(1));

    expect(goBack).not.toHaveBeenCalled();
  });

  it('swipe left opens the members drawer for a channel', () => {
    const { rerender } = renderWithProviders(
      <MobileChatPanel communityId="c1" channelId="ch1" />,
    );

    expect(membersDrawerOpen()).toBe(false);

    act(() => captured.opts?.onSwipeLeft?.(1));
    // Re-render to flush the state update that opens the drawer.
    rerender(<MobileChatPanel communityId="c1" channelId="ch1" />);

    expect(membersDrawerOpen()).toBe(true);
    expect(goBack).not.toHaveBeenCalled();
  });

  it('swipe left still opens the members drawer on tablet', () => {
    mockUseResponsive.mockReturnValue({ shouldUseTouchUI: true, isMobile: false });
    const { rerender } = renderWithProviders(
      <MobileChatPanel communityId="c1" channelId="ch1" />,
    );

    expect(membersDrawerOpen()).toBe(false);

    act(() => captured.opts?.onSwipeLeft?.(1));
    rerender(<MobileChatPanel communityId="c1" channelId="ch1" />);

    expect(membersDrawerOpen()).toBe(true);
  });

  it('swipe left does not open a members drawer in a DM (no channel)', () => {
    const { rerender } = renderWithProviders(<MobileChatPanel dmGroupId="dm1" />);

    act(() => captured.opts?.onSwipeLeft?.(1));
    rerender(<MobileChatPanel dmGroupId="dm1" />);

    expect(membersDrawerOpen()).toBe(false);
  });
});
