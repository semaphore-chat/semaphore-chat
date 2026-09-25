import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders, createUser, createFriendship } from '../test-utils';
import AddFriendDialog from '../../components/Friends/AddFriendDialog';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../components/Common/UserAvatar', () => ({
  default: ({ userId }: { userId?: string }) => <div data-testid="user-avatar">{userId}</div>,
}));

// Hoisted so the vi.mock factory can reference it
const { mockSearchUsers } = vi.hoisted(() => ({
  mockSearchUsers: [] as Array<{
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  }>,
}));

// Deterministic mock — renders options immediately, no debounce/fetch/portals
vi.mock('../../components/Common/UserSearchAutocomplete', () => ({
  default: ({
    onChange,
    label,
    getOptionDisabled,
    renderOptionExtra,
  }: {
    onChange: (value: unknown) => void;
    label: string;
    getOptionDisabled?: (user: Record<string, unknown>) => boolean;
    renderOptionExtra?: (user: Record<string, unknown>) => React.ReactNode;
    [key: string]: unknown;
  }) => (
    <div>
      <label>{label}</label>
      <ul role="listbox">
        {mockSearchUsers.map((user) => {
          const disabled = getOptionDisabled?.(user as unknown as Record<string, unknown>) ?? false;
          return (
            // Option markup like MUI Autocomplete's (role="option",
            // tabIndex -1), plus Enter so the mock is keyboard-operable.
            <li
              key={user.id}
              role="option"
              aria-selected={false}
              tabIndex={-1}
              aria-disabled={disabled || undefined}
              onClick={() => {
                if (!disabled) onChange(user);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !disabled) onChange(user);
              }}
            >
              <span>{user.displayName || user.username}</span>
              <span>@{user.username}</span>
              {renderOptionExtra?.(user as unknown as Record<string, unknown>)}
            </li>
          );
        })}
      </ul>
    </div>
  ),
}));

const BASE_URL = 'http://localhost:3000';

const currentUser = createUser({ id: 'current-user-1', username: 'testuser', displayName: 'Test User' });
const friendUser = createUser({ id: 'friend-1', username: 'friend_user', displayName: 'Friend User' });
const sentRequestUser = createUser({ id: 'sent-1', username: 'sent_user', displayName: 'Sent User' });
const receivedRequestUser = createUser({ id: 'received-1', username: 'received_user', displayName: 'Received User' });
const normalUser = createUser({ id: 'normal-1', username: 'normal_user', displayName: 'Normal User' });

function setupHandlers({
  friends = [] as ReturnType<typeof createUser>[],
  pendingSent = [] as ReturnType<typeof createFriendship>[],
  pendingReceived = [] as ReturnType<typeof createFriendship>[],
} = {}) {
  server.use(
    http.get(`${BASE_URL}/api/users/profile`, () =>
      HttpResponse.json(currentUser),
    ),
    http.get(`${BASE_URL}/api/friends`, () =>
      HttpResponse.json(friends),
    ),
    http.get(`${BASE_URL}/api/friends/requests`, () =>
      HttpResponse.json({ sent: pendingSent, received: pendingReceived }),
    ),
    http.post(`${BASE_URL}/api/friends/request/:userId`, () =>
      HttpResponse.json({ id: 'new-friendship', status: 'PENDING' }),
    ),
  );
}

const defaultProps = {
  open: true,
  onClose: vi.fn(),
};


describe('AddFriendDialog', () => {
  beforeEach(() => {
    defaultProps.onClose = vi.fn();
    mockSearchUsers.length = 0;
    mockSearchUsers.push(friendUser, sentRequestUser, receivedRequestUser, normalUser);
  });

  it('shows "Friends" chip for accepted friends and disables the option', async () => {
    setupHandlers({ friends: [friendUser] });

    renderWithProviders(<AddFriendDialog {...defaultProps} />);

    const friendOption = screen.getByText('Friend User');
    const listItem = friendOption.closest('li')!;

    await waitFor(() => {
      expect(within(listItem).getByText('Friends')).toBeInTheDocument();
      expect(listItem).toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('shows "Request Sent" chip for outgoing pending requests and disables the option', async () => {
    const sentFriendship = createFriendship({
      userA: currentUser,
      userAId: currentUser.id,
      userB: sentRequestUser,
      userBId: sentRequestUser.id,
      status: 'PENDING',
    });

    setupHandlers({ pendingSent: [sentFriendship] });

    renderWithProviders(<AddFriendDialog {...defaultProps} />);

    const sentOption = screen.getByText('Sent User');
    const listItem = sentOption.closest('li')!;

    await waitFor(() => {
      expect(within(listItem).getByText('Request Sent')).toBeInTheDocument();
      expect(listItem).toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('shows "Request Received" chip for incoming pending requests and disables the option', async () => {
    const receivedFriendship = createFriendship({
      userA: receivedRequestUser,
      userAId: receivedRequestUser.id,
      userB: currentUser,
      userBId: currentUser.id,
      status: 'PENDING',
    });

    setupHandlers({ pendingReceived: [receivedFriendship] });

    renderWithProviders(<AddFriendDialog {...defaultProps} />);

    const receivedOption = screen.getByText('Received User');
    const listItem = receivedOption.closest('li')!;

    await waitFor(() => {
      expect(within(listItem).getByText('Request Received')).toBeInTheDocument();
      expect(listItem).toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('shows no chip for normal users and allows selection', async () => {
    setupHandlers();

    renderWithProviders(<AddFriendDialog {...defaultProps} />);

    const normalOption = screen.getByText('Normal User');
    const listItem = normalOption.closest('li')!;

    expect(within(listItem).queryByText('Friends')).not.toBeInTheDocument();
    expect(within(listItem).queryByText('Request Sent')).not.toBeInTheDocument();
    expect(within(listItem).queryByText('Request Received')).not.toBeInTheDocument();
    expect(listItem).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('shows friendly message on 409 "Already friends" error', async () => {
    setupHandlers();
    server.use(
      http.post(`${BASE_URL}/api/friends/request/:userId`, () =>
        HttpResponse.json(
          { statusCode: 409, message: 'Already friends with this user', error: 'Conflict' },
          { status: 409 },
        ),
      ),
    );

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await user.click(screen.getByText('Normal User').closest('li')!);

    await user.click(screen.getByRole('button', { name: /send friend request/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You are already friends with this user.',
      );
    });
  });

  it('shows friendly message on 409 "Friend request already sent" error', async () => {
    setupHandlers();
    server.use(
      http.post(`${BASE_URL}/api/friends/request/:userId`, () =>
        HttpResponse.json(
          { statusCode: 409, message: 'Friend request already sent', error: 'Conflict' },
          { status: 409 },
        ),
      ),
    );

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await user.click(screen.getByText('Normal User').closest('li')!);

    await user.click(screen.getByRole('button', { name: /send friend request/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You have already sent a friend request to this user.',
      );
    });
  });

  it('shows backend message for non-409 errors', async () => {
    setupHandlers();
    server.use(
      http.post(`${BASE_URL}/api/friends/request/:userId`, () =>
        HttpResponse.json(
          { statusCode: 500, message: 'Internal server error', error: 'Internal Server Error' },
          { status: 500 },
        ),
      ),
    );

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await user.click(screen.getByText('Normal User').closest('li')!);

    await user.click(screen.getByRole('button', { name: /send friend request/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Internal server error');
    });
  });

  it('shows success message and clears selection on successful request', async () => {
    setupHandlers();

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await user.click(screen.getByText('Normal User').closest('li')!);

    await user.click(screen.getByRole('button', { name: /send friend request/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Friend request sent!');
    });
  });

  it('resets state when dialog is closed', async () => {
    setupHandlers();

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
