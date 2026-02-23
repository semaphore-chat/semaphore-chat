import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import DirectMessageList from '../../components/DirectMessages/DirectMessageList';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// Mock child components to isolate DirectMessageList
vi.mock('../../components/Common/UserAvatar', () => ({
  default: ({ user }: { user: unknown }) => <div data-testid="user-avatar">{(user as { username?: string })?.username}</div>,
}));

vi.mock('../../components/Common/UserSearchAutocomplete', () => ({
  default: (props: { label: string }) => <div data-testid="user-search">{props.label}</div>,
  UserOption: {},
}));

vi.mock('../../components/Common/EmptyState', () => ({
  default: ({ variant }: { variant: string }) => <div data-testid="empty-state">Empty {variant}</div>,
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: vi.fn(() => ({
    state: { isConnected: false, contextType: null, currentDmGroupId: null },
    actions: {},
  })),
}));

const defaultProps = {
  onSelectDmGroup: vi.fn(),
  showCreateDialog: false,
  setShowCreateDialog: vi.fn(),
};

describe('DirectMessageList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while fetching', () => {
    renderWithProviders(<DirectMessageList {...defaultProps} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders DM groups', async () => {
    server.use(
      http.get('http://localhost:3000/api/direct-messages', () => {
        return HttpResponse.json([
          {
            id: 'dm-1',
            name: null,
            isGroup: false,
            createdAt: '2025-01-01T00:00:00Z',
            members: [
              { id: 'm1', userId: 'current-user-1', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'current-user-1', username: 'testuser', displayName: 'Test User', avatarUrl: null } },
              { id: 'm2', userId: 'u2', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'u2', username: 'alice', displayName: 'Alice', avatarUrl: null } },
            ],
            lastMessage: null,
          },
          {
            id: 'dm-2',
            name: null,
            isGroup: false,
            createdAt: '2025-01-01T00:00:00Z',
            members: [
              { id: 'm3', userId: 'current-user-1', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'current-user-1', username: 'testuser', displayName: 'Test User', avatarUrl: null } },
              { id: 'm4', userId: 'u3', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'u3', username: 'bob', displayName: 'Bob', avatarUrl: null } },
            ],
            lastMessage: null,
          },
        ]);
      })
    );

    renderWithProviders(<DirectMessageList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows other user name for 1:1 DM', async () => {
    server.use(
      http.get('http://localhost:3000/api/direct-messages', () => {
        return HttpResponse.json([
          {
            id: 'dm-1',
            name: null,
            isGroup: false,
            createdAt: '2025-01-01T00:00:00Z',
            members: [
              { id: 'm1', userId: 'current-user-1', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'current-user-1', username: 'testuser', displayName: 'Test User', avatarUrl: null } },
              { id: 'm2', userId: 'u2', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'u2', username: 'alice', displayName: 'Alice Smith', avatarUrl: null } },
            ],
            lastMessage: null,
          },
        ]);
      })
    );

    renderWithProviders(<DirectMessageList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    // Should NOT show current user's name
    expect(screen.queryByText('Test User')).not.toBeInTheDocument();
  });

  it('shows comma-separated names for group DM', async () => {
    server.use(
      http.get('http://localhost:3000/api/direct-messages', () => {
        return HttpResponse.json([
          {
            id: 'dm-1',
            name: null,
            isGroup: true,
            createdAt: '2025-01-01T00:00:00Z',
            members: [
              { id: 'm1', userId: 'current-user-1', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'current-user-1', username: 'testuser', displayName: 'Test User', avatarUrl: null } },
              { id: 'm2', userId: 'u2', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'u2', username: 'alice', displayName: 'Alice', avatarUrl: null } },
              { id: 'm3', userId: 'u3', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'u3', username: 'bob', displayName: 'Bob', avatarUrl: null } },
            ],
            lastMessage: null,
          },
        ]);
      })
    );

    renderWithProviders(<DirectMessageList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Alice, Bob')).toBeInTheDocument();
    });
  });

  it('shows group name when set', async () => {
    server.use(
      http.get('http://localhost:3000/api/direct-messages', () => {
        return HttpResponse.json([
          {
            id: 'dm-1',
            name: 'Team Chat',
            isGroup: true,
            createdAt: '2025-01-01T00:00:00Z',
            members: [
              { id: 'm1', userId: 'current-user-1', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'current-user-1', username: 'testuser', displayName: 'Test User', avatarUrl: null } },
              { id: 'm2', userId: 'u2', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'u2', username: 'alice', displayName: 'Alice', avatarUrl: null } },
            ],
            lastMessage: null,
          },
        ]);
      })
    );

    renderWithProviders(<DirectMessageList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Team Chat')).toBeInTheDocument();
    });
  });

  it('shows last message preview from PLAINTEXT span', async () => {
    server.use(
      http.get('http://localhost:3000/api/direct-messages', () => {
        return HttpResponse.json([
          {
            id: 'dm-1',
            name: null,
            isGroup: false,
            createdAt: '2025-01-01T00:00:00Z',
            members: [
              { id: 'm1', userId: 'current-user-1', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'current-user-1', username: 'testuser', displayName: 'Test User', avatarUrl: null } },
              { id: 'm2', userId: 'u2', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'u2', username: 'alice', displayName: 'Alice', avatarUrl: null } },
            ],
            lastMessage: {
              id: 'msg-1',
              authorId: 'u2',
              spans: [{ type: 'PLAINTEXT', text: 'Hey there!' }],
              sentAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
            },
          },
        ]);
      })
    );

    renderWithProviders(<DirectMessageList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Hey there!')).toBeInTheDocument();
    });
  });

  it('shows "No messages yet" when no last message', async () => {
    server.use(
      http.get('http://localhost:3000/api/direct-messages', () => {
        return HttpResponse.json([
          {
            id: 'dm-1',
            name: null,
            isGroup: false,
            createdAt: '2025-01-01T00:00:00Z',
            members: [
              { id: 'm1', userId: 'current-user-1', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'current-user-1', username: 'testuser', displayName: 'Test User', avatarUrl: null } },
              { id: 'm2', userId: 'u2', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'u2', username: 'alice', displayName: 'Alice', avatarUrl: null } },
            ],
            lastMessage: null,
          },
        ]);
      })
    );

    renderWithProviders(<DirectMessageList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet')).toBeInTheDocument();
    });
  });

  it('calls onSelectDmGroup when clicking a DM', async () => {
    const onSelect = vi.fn();
    server.use(
      http.get('http://localhost:3000/api/direct-messages', () => {
        return HttpResponse.json([
          {
            id: 'dm-1',
            name: null,
            isGroup: false,
            createdAt: '2025-01-01T00:00:00Z',
            members: [
              { id: 'm1', userId: 'current-user-1', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'current-user-1', username: 'testuser', displayName: 'Test User', avatarUrl: null } },
              { id: 'm2', userId: 'u2', joinedAt: '2025-01-01T00:00:00Z', user: { id: 'u2', username: 'alice', displayName: 'Alice', avatarUrl: null } },
            ],
            lastMessage: null,
          },
        ]);
      })
    );

    const { user } = renderWithProviders(
      <DirectMessageList {...defaultProps} onSelectDmGroup={onSelect} />
    );

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Alice'));
    expect(onSelect).toHaveBeenCalledWith('dm-1');
  });

  it('shows empty state when no DM groups', async () => {
    // Default handler already returns []
    renderWithProviders(<DirectMessageList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('shows create DM dialog when showCreateDialog is true', async () => {
    renderWithProviders(
      <DirectMessageList {...defaultProps} showCreateDialog={true} />
    );

    await waitFor(() => {
      expect(screen.getByText('Start a Direct Message')).toBeInTheDocument();
    });
  });
});
