/**
 * Every list that adopted `ListState` must show an error with a retry on a
 * failed fetch (500), never its "nothing here" copy, and a skeleton (not an
 * empty state) while loading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders, createMessage } from '../test-utils';
import DirectMessageList from '../../components/DirectMessages/DirectMessageList';
import { MobileMessagesPanel } from '../../components/Mobile/Panels/MobileMessagesPanel';
import { NotificationList } from '../../components/Notifications/NotificationList';
import { ThreadPanel } from '../../components/Thread/ThreadPanel';
import MemberListContainer from '../../components/Message/MemberListContainer';
import { VoiceSessionType } from '../../contexts/VoiceContext';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ shouldUseTouchUI: true, isMobile: true }),
}));
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: { isConnected: false } }),
}));
vi.mock('../../hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({ unreadCount: () => 0, mentionCount: () => 0 }),
}));
vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({ navigateToDmChat: vi.fn() }),
}));
vi.mock('../../components/Mobile/MobileAppBar', () => ({
  default: () => <div data-testid="mobile-app-bar" />,
}));
vi.mock('../../components/DirectMessages/DmListItem', () => ({
  default: ({ group }: { group: { id: string } }) => <li data-testid="dm-list-item">{group.id}</li>,
}));
vi.mock('../../components/DirectMessages/CreateDmDialog', () => ({
  default: () => null,
}));
vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="user-avatar" />,
}));
vi.mock('../../components/Moderation', () => ({
  UserModerationMenu: () => null,
}));
vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ openProfile: vi.fn() }),
}));
vi.mock('../../contexts/ThreadPanelContext', () => ({
  useThreadPanel: () => ({ closeThread: vi.fn() }),
}));
vi.mock('../../hooks/useThreadSubscription', () => ({
  useThreadSubscription: () => ({ isSubscribed: false, toggleSubscription: vi.fn() }),
}));
vi.mock('../../components/Message/MessageComponent', () => ({
  default: ({ message }: { message: { id: string } }) => <div data-testid="message">{message.id}</div>,
}));
vi.mock('../../components/Thread/ThreadMessageInput', () => ({
  default: () => <div data-testid="thread-input" />,
}));

const BASE = 'http://localhost:3000';
const fail500 = () => HttpResponse.json({ message: 'Internal server error' }, { status: 500 });
const hang = async () => {
  await delay('infinite');
  return HttpResponse.json({});
};

const dmGroup = {
  id: 'dm-1',
  name: null,
  isGroup: false,
  createdAt: '2025-01-01T00:00:00Z',
  members: [],
  lastMessage: null,
};

async function expectErrorWithRetry(emptyCopy: RegExp) {
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('button', { name: /try again/i })).toBeInTheDocument();
  expect(screen.queryByText(emptyCopy)).not.toBeInTheDocument();
  return alert;
}

describe('ListState adoption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no scrollIntoView (ThreadPanel scrolls to the newest reply).
    Element.prototype.scrollIntoView = vi.fn();
  });

  describe('DirectMessageList (desktop)', () => {
    const props = { onSelectDmGroup: vi.fn(), showCreateDialog: false, setShowCreateDialog: vi.fn() };

    it('shows an error with retry on a 500, not "No conversations", and recovers on retry', async () => {
      server.use(http.get(`${BASE}/api/direct-messages`, fail500));
      const { user } = renderWithProviders(<DirectMessageList {...props} />);
      const alert = await expectErrorWithRetry(/no conversations/i);

      server.use(http.get(`${BASE}/api/direct-messages`, () => HttpResponse.json([dmGroup])));
      await user.click(within(alert).getByRole('button', { name: /try again/i }));
      expect(await screen.findByTestId('dm-list-item')).toHaveTextContent('dm-1');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows a skeleton while loading', () => {
      server.use(http.get(`${BASE}/api/direct-messages`, hang));
      renderWithProviders(<DirectMessageList {...props} />);
      expect(screen.getByRole('progressbar', { name: /loading/i })).toBeInTheDocument();
      expect(screen.queryByText(/no conversations/i)).not.toBeInTheDocument();
    });
  });

  describe('MobileMessagesPanel', () => {
    it('shows an error with retry on a 500, not "No messages yet"', async () => {
      server.use(http.get(`${BASE}/api/direct-messages`, fail500));
      renderWithProviders(<MobileMessagesPanel />);
      await expectErrorWithRetry(/no messages yet|no conversations/i);
    });

    it('shows a skeleton (not a bare spinner) while loading', () => {
      server.use(http.get(`${BASE}/api/direct-messages`, hang));
      renderWithProviders(<MobileMessagesPanel />);
      expect(screen.getByRole('progressbar', { name: /loading/i })).toBeInTheDocument();
      expect(document.querySelector('.MuiSkeleton-root')).not.toBeNull();
    });
  });

  describe('NotificationList', () => {
    it('shows an error with retry on a 500, not "No notifications"', async () => {
      server.use(http.get(`${BASE}/api/notifications`, fail500));
      renderWithProviders(<NotificationList />);
      await expectErrorWithRetry(/no notifications/i);
    });

    it('shows a skeleton while loading', () => {
      server.use(http.get(`${BASE}/api/notifications`, hang));
      renderWithProviders(<NotificationList />);
      expect(screen.getByRole('progressbar', { name: /loading/i })).toBeInTheDocument();
      expect(document.querySelector('.MuiSkeleton-root')).not.toBeNull();
    });
  });

  describe('ThreadPanel', () => {
    const parent = createMessage({ id: 'parent-1' });

    it('shows an error with retry on a 500, not "No replies yet"', async () => {
      server.use(http.get(`${BASE}/api/threads/:parentMessageId/replies`, fail500));
      renderWithProviders(<ThreadPanel parentMessage={parent} channelId="channel-1" communityId="community-1" />);
      await expectErrorWithRetry(/no replies yet/i);
      // The parent message and the reply box stay usable.
      expect(screen.getByTestId('message')).toHaveTextContent('parent-1');
      expect(screen.getByTestId('thread-input')).toBeInTheDocument();
    });

    it('shows a skeleton while loading', () => {
      server.use(http.get(`${BASE}/api/threads/:parentMessageId/replies`, hang));
      renderWithProviders(<ThreadPanel parentMessage={parent} channelId="channel-1" communityId="community-1" />);
      expect(screen.getByRole('progressbar', { name: /loading/i })).toBeInTheDocument();
    });
  });

  describe('MemberListContainer', () => {
    it('shows an error with retry on a 500, not "No members", and recovers on retry', async () => {
      server.use(http.get(`${BASE}/api/membership/community/:communityId`, fail500));
      const { user } = renderWithProviders(
        <MemberListContainer
          contextType={VoiceSessionType.Channel}
          contextId="channel-1"
          communityId="community-1"
          isPrivate={false}
        />,
      );
      const alert = await expectErrorWithRetry(/no members/i);

      server.use(
        http.get(`${BASE}/api/membership/community/:communityId`, () =>
          HttpResponse.json({
            members: [
              {
                id: 'mem-a',
                userId: 'user-a',
                communityId: 'community-1',
                joinedAt: '2025-01-01T00:00:00Z',
                roles: [],
                user: { id: 'user-a', username: 'alice', displayName: 'Alice', avatarUrl: null, status: null },
              },
            ],
          }),
        ),
        http.get(`${BASE}/api/presence/users/:userIds`, () => HttpResponse.json({ presence: {} })),
      );
      await user.click(within(alert).getByRole('button', { name: /try again/i }));
      expect(await screen.findByText('Alice')).toBeInTheDocument();
    });

    it('does not skeleton forever when the channel itself 403s (isPrivate unknown)', async () => {
      server.use(
        http.get(`${BASE}/api/channels/:id`, () =>
          HttpResponse.json({ message: 'Forbidden resource' }, { status: 403 }),
        ),
      );
      renderWithProviders(
        <MemberListContainer
          contextType={VoiceSessionType.Channel}
          contextId="channel-private"
          communityId="community-1"
          isPrivate={undefined}
        />,
      );
      await screen.findByRole('alert');
      await waitFor(() => {
        expect(screen.queryByRole('progressbar', { name: /loading/i })).not.toBeInTheDocument();
      });
    });

    it('resolves isPrivate from the channel when the parent has not got it yet', async () => {
      server.use(
        http.get(`${BASE}/api/channels/:id`, () =>
          HttpResponse.json({ id: 'channel-1', name: 'general', isPrivate: false, communityId: 'community-1' }),
        ),
        http.get(`${BASE}/api/presence/users/:userIds`, () => HttpResponse.json({ presence: {} })),
      );
      renderWithProviders(
        <MemberListContainer
          contextType={VoiceSessionType.Channel}
          contextId="channel-1"
          communityId="community-1"
          isPrivate={undefined}
        />,
      );
      // Default MSW membership handler returns members; the list must leave loading.
      await waitFor(() => {
        expect(screen.queryByRole('progressbar', { name: /loading/i })).not.toBeInTheDocument();
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
