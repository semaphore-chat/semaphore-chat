import userEvent from '@testing-library/user-event';
/**
 * NotificationList — compact rows (mobile UX overhaul, Task 15).
 *
 * - display name, not username
 * - a real label per type, including thread replies
 * - inline mark-read/dismiss icons on desktop, long-press action sheet on touch
 * - no nested <p> (the old ListItemText secondary put <p>s inside a <p>)
 * - one-line (noWrap) name/preview for long and RTL content (Review Focus #3)
 * - renders in every theme (Review Focus #2)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { renderInEveryTheme } from '../test-utils/themeMatrix';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Notification } from '../../types/notification.type';
import { NotificationType } from '../../types/notification.type';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../hooks/useAuthenticatedImage', () => ({
  useAuthenticatedImage: () => ({ blobUrl: null, isLoading: false, error: null }),
}));

const mockResponsive = { shouldUseTouchUI: false, isMobile: false, isTablet: false, isDesktop: true };
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => mockResponsive,
}));

const handleMarkAsRead = vi.fn();
let mockNotifications: Notification[] = [];

vi.mock('../../hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: mockNotifications,
    unreadCount: mockNotifications.filter((n) => !n.read).length,
    hasUnread: mockNotifications.some((n) => !n.read),
    isLoading: false,
    isMarkingAllRead: false,
    error: null,
    refetch: vi.fn(),
    handleMarkAsRead,
    handleMarkAllAsRead: vi.fn(),
    invalidateNotifications: vi.fn(),
  }),
}));

import { NotificationList } from '../../components/Notifications/NotificationList';

let counter = 0;
function makeNotification(overrides: Partial<Notification> = {}): Notification {
  counter += 1;
  return {
    id: `notif-${counter}`,
    userId: 'me',
    type: NotificationType.USER_MENTION,
    messageId: `msg-${counter}`,
    channelId: 'channel-1',
    directMessageGroupId: null,
    communityId: 'community-1',
    authorId: 'author-1',
    read: false,
    dismissed: false,
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    author: { id: 'author-1', username: 'priya_d', displayName: 'Priya Diallo', avatarUrl: null },
    message: { id: `msg-${counter}`, spans: [{ type: 'PLAINTEXT', text: 'hello there' }] },
    ...overrides,
  };
}

describe('NotificationList (compact rows)', () => {
  beforeEach(() => {
    handleMarkAsRead.mockReset();
    mockResponsive.shouldUseTouchUI = false;
    mockResponsive.isMobile = false;
    mockResponsive.isDesktop = true;
    mockNotifications = [makeNotification()];
  });

  it('shows the display name, not the username', () => {
    renderWithProviders(<NotificationList />);
    expect(screen.getByText('Priya Diallo')).toBeInTheDocument();
    expect(screen.queryByText('priya_d')).not.toBeInTheDocument();
  });

  it('falls back to the username when there is no display name', () => {
    mockNotifications = [
      makeNotification({ author: { id: 'a', username: 'no_display', displayName: null, avatarUrl: null } }),
    ];
    renderWithProviders(<NotificationList />);
    expect(screen.getByText('no_display')).toBeInTheDocument();
  });

  it.each([
    [NotificationType.USER_MENTION, 'Mentioned you'],
    [NotificationType.SPECIAL_MENTION, 'Mentioned everyone'],
    [NotificationType.DIRECT_MESSAGE, 'Sent a message'],
    [NotificationType.CHANNEL_MESSAGE, 'New message'],
    [NotificationType.THREAD_REPLY, 'Replied in a thread'],
  ])('labels %s notifications as "%s"', (type, label) => {
    mockNotifications = [makeNotification({ type })];
    renderWithProviders(<NotificationList />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText('Notification')).not.toBeInTheDocument();
  });

  it('does not nest <p> elements', () => {
    const { container } = renderWithProviders(<NotificationList />);
    expect(container.querySelectorAll('p p')).toHaveLength(0);
    expect(container.querySelectorAll('p div')).toHaveLength(0);
  });

  it('keeps long no-space and Arabic names and previews on one line', () => {
    const longName = 'x'.repeat(32);
    const arabicName = 'عبد الرحمن بن محمد الهاشمي';
    mockNotifications = [
      makeNotification({ author: { id: 'a', username: 'u1', displayName: longName, avatarUrl: null } }),
      makeNotification({
        author: { id: 'b', username: 'u2', displayName: arabicName, avatarUrl: null },
        message: { id: 'm', spans: [{ type: 'PLAINTEXT', text: 'مرحبا! كيف حالك اليوم؟ '.repeat(8) }] },
      }),
    ];
    renderWithProviders(<NotificationList />);
    for (const name of [longName, arabicName]) {
      const el = screen.getByText(name);
      expect(el).toHaveStyle({ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
    }
    const preview = screen.getByText(/كيف حالك/);
    expect(preview).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
  });

  // jsdom has no layout, so this pins the flex contract that decides who gives
  // way: the name shrinks (and ellipsizes), the type label never does. The
  // label used to carry flex-shrink 1000 and collapsed to "M…" next to a
  // 32-character name.
  it.each([
    [NotificationType.USER_MENTION, 'Mentioned you'],
    [NotificationType.SPECIAL_MENTION, 'Mentioned everyone'],
    [NotificationType.DIRECT_MESSAGE, 'Sent a message'],
    [NotificationType.CHANNEL_MESSAGE, 'New message'],
    [NotificationType.THREAD_REPLY, 'Replied in a thread'],
  ])('truncates a long name before the %s label', (type, label) => {
    const longName = 'Maximilian Alexander Featherston';
    mockNotifications = [
      makeNotification({ type, author: { id: 'a', username: 'u1', displayName: longName, avatarUrl: null } }),
    ];
    renderWithProviders(<NotificationList />);
    expect(screen.getByText(longName)).toHaveStyle({
      flexShrink: '1',
      minWidth: '0px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    expect(screen.getByText(label)).toHaveStyle({ flexShrink: '0', whiteSpace: 'nowrap' });
  });

  describe('desktop (pointer)', () => {
    it('shows inline mark-read and dismiss icons', () => {
      renderWithProviders(<NotificationList />);
      expect(screen.getByRole('button', { name: 'Mark as read' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });

    it('hides mark-read on read notifications', () => {
      mockNotifications = [makeNotification({ read: true })];
      renderWithProviders(<NotificationList />);
      expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });

    it('marks as read from the inline icon', async () => {
      const [n] = mockNotifications;
      const { user } = renderWithProviders(<NotificationList />);
      await user.click(screen.getByRole('button', { name: 'Mark as read' }));
      expect(handleMarkAsRead).toHaveBeenCalledWith(n.id);
    });
  });

  describe('touch', () => {
    beforeEach(() => {
      mockResponsive.shouldUseTouchUI = true;
      mockResponsive.isMobile = true;
      mockResponsive.isDesktop = false;
    });

    it('has no inline action icons', () => {
      renderWithProviders(<NotificationList />);
      expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    });

    it('rows are at least 44px tall', () => {
      renderWithProviders(<NotificationList />);
      const row = screen.getByTestId(`notification-row-${mockNotifications[0].id}`);
      expect(row).toHaveStyle({ minHeight: '56px' });
    });

    it('long-press opens an action sheet with mark-read and dismiss', async () => {
      const [n] = mockNotifications;
      renderWithProviders(<NotificationList />);
      const row = screen.getByTestId(`notification-row-${n.id}`);
      fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] });
      const sheet = await screen.findByRole('presentation', {}, { timeout: 2000 });
      fireEvent.touchEnd(row);
      const markRead = within(sheet).getByRole('button', { name: /mark as read/i });
      expect(within(sheet).getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
      fireEvent.click(markRead);
      expect(handleMarkAsRead).toHaveBeenCalledWith(n.id);
      await waitFor(() => expect(screen.queryByRole('presentation')).not.toBeInTheDocument());
    });

    it('exposes a "More actions" button for screen-reader and switch users', async () => {
      renderWithProviders(<NotificationList />);
      await userEvent.setup().click(screen.getByRole('button', { name: 'More actions' }));
      const sheet = await screen.findByRole('presentation');
      expect(within(sheet).getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('announces unread state with real text, not aria-label on a bare span', () => {
      renderWithProviders(<NotificationList />);
      const row = screen.getByTestId(`notification-row-${mockNotifications[0].id}`);
      expect(within(row).getByText('Unread')).toBeInTheDocument();
      expect(screen.getByTestId('notification-unread-dot')).toHaveAttribute('aria-hidden', 'true');
    });

    it('right-click opens the action sheet (mouse on a touch-UI layout)', async () => {
      const [n] = mockNotifications;
      renderWithProviders(<NotificationList />);
      fireEvent.contextMenu(screen.getByTestId(`notification-row-${n.id}`));
      const sheet = await screen.findByRole('presentation');
      expect(within(sheet).getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });
  });

  it('renders in every theme', () => {
    renderInEveryTheme(
      () => (
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <NotificationList />
          </MemoryRouter>
        </QueryClientProvider>
      ),
      () => {
        expect(screen.getByText('Priya Diallo')).toBeInTheDocument();
      },
    );
  });
});
