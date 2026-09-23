import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { MobileMessagesPanel } from '../../components/Mobile/Panels/MobileMessagesPanel';

vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({ navigateToDmChat: vi.fn() }),
}));

// Force touch UI on so pull-to-refresh handlers are attached.
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ shouldUseTouchUI: true, isMobile: true }),
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: { isConnected: false } }),
}));

vi.mock('../../hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({ unreadCount: () => 0, mentionCount: () => 0 }),
}));

vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  directMessagesControllerFindUserDmGroupsOptions: () => ({
    queryKey: ['dm-groups'],
    queryFn: async () => [],
  }),
  userControllerGetProfileOptions: () => ({
    queryKey: ['profile'],
    queryFn: async () => ({ id: 'u1' }),
  }),
}));

vi.mock('../../components/DirectMessages/DmListItem', () => ({
  default: () => <li data-testid="dm-list-item" />,
}));

vi.mock('../../components/DirectMessages/CreateDmDialog', () => ({
  default: () => <div data-testid="create-dm-dialog" />,
}));

vi.mock('../../components/Mobile/MobileAppBar', () => ({
  default: () => <div data-testid="mobile-app-bar" />,
}));

describe('MobileMessagesPanel pull-to-refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refetches DM groups when pulled past the threshold', async () => {
    const { queryClient } = renderWithProviders(<MobileMessagesPanel />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Wait for the loaded (empty) state, not the loading skeleton.
    await screen.findByText('No messages yet');
    const scrollBox = screen.getByTestId('dm-list-scroll');

    fireEvent.touchStart(scrollBox, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(scrollBox, { touches: [{ clientY: 140 }] }); // past 80px threshold
    fireEvent.touchEnd(scrollBox);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['dm-groups'] }),
      );
    });
  });

  it('does not refetch for a short pull under the threshold', async () => {
    const { queryClient } = renderWithProviders(<MobileMessagesPanel />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await screen.findByText('No messages yet');
    const scrollBox = screen.getByTestId('dm-list-scroll');

    fireEvent.touchStart(scrollBox, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(scrollBox, { touches: [{ clientY: 30 }] }); // under 80px
    fireEvent.touchEnd(scrollBox);

    // Give any async handler a tick; invalidate must not have fired.
    await new Promise((r) => setTimeout(r, 0));
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['dm-groups'] }),
    );
  });
});

describe('MobileMessagesPanel new-DM button', () => {
  it('leaves room below the list so the FAB never covers the last conversation', async () => {
    renderWithProviders(<MobileMessagesPanel />);
    await screen.findByText('No messages yet');
    // FAB is 56px tall and sits 16px above the bottom chrome; the scroll box
    // pads its end by at least that much.
    const scrollBox = screen.getByTestId('dm-list-scroll');
    expect(scrollBox).toHaveStyle({ paddingBottom: '88px' });
  });
});
