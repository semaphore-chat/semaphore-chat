import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders, createUser, createFriendship } from '../test-utils';
import AddFriendDialog from '../../components/Friends/AddFriendDialog';
import type { default as userEvent } from '@testing-library/user-event';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../components/Common/UserAvatar', () => ({
  default: ({ user }: { user: { username?: string } }) => <div data-testid="user-avatar">{user?.username}</div>,
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
  users = [friendUser, sentRequestUser, receivedRequestUser, normalUser],
} = {}) {
  server.use(
    http.get(`${BASE_URL}/api/users/profile`, () =>
      HttpResponse.json(currentUser),
    ),
    http.get(`${BASE_URL}/api/users/search`, () =>
      HttpResponse.json([currentUser, ...users]),
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

/** Type a search query and wait for debounced results to appear */
async function typeAndWaitForResults(user: ReturnType<typeof userEvent.setup>, query: string) {
  const input = screen.getByLabelText('Search for a user');
  await user.click(input);
  await user.type(input, query);
  await waitFor(() => {
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  }, { timeout: 3000 });
}

/** Select a user from the search results and wait for the button to become enabled */
async function selectUserAndWaitForButton(user: ReturnType<typeof userEvent.setup>, displayName: string) {
  const option = await screen.findByText(displayName);
  await user.click(option);
  // Wait for the selection to be committed and button to become enabled
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /send friend request/i })).toBeEnabled();
  }, { timeout: 2000 });
}

const defaultProps = {
  open: true,
  onClose: vi.fn(),
};

beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe('AddFriendDialog', () => {
  beforeEach(() => {
    defaultProps.onClose = vi.fn();
  });

  it('shows "Friends" chip for accepted friends and disables the option', { timeout: 10000 }, async () => {
    setupHandlers({
      friends: [friendUser],
    });

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await typeAndWaitForResults(user, 'friend');

    const friendOption = await screen.findByText('Friend User');
    const listItem = friendOption.closest('li')!;
    expect(within(listItem).getByText('Friends')).toBeInTheDocument();
    expect(listItem).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows "Request Sent" chip for outgoing pending requests and disables the option', { timeout: 10000 }, async () => {
    const sentFriendship = createFriendship({
      userA: currentUser,
      userAId: currentUser.id,
      userB: sentRequestUser,
      userBId: sentRequestUser.id,
      status: 'PENDING',
    });

    setupHandlers({
      pendingSent: [sentFriendship],
    });

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await typeAndWaitForResults(user, 'sent');

    const sentOption = await screen.findByText('Sent User');
    const listItem = sentOption.closest('li')!;
    expect(within(listItem).getByText('Request Sent')).toBeInTheDocument();
    expect(listItem).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows "Request Received" chip for incoming pending requests and disables the option', { timeout: 10000 }, async () => {
    const receivedFriendship = createFriendship({
      userA: receivedRequestUser,
      userAId: receivedRequestUser.id,
      userB: currentUser,
      userBId: currentUser.id,
      status: 'PENDING',
    });

    setupHandlers({
      pendingReceived: [receivedFriendship],
    });

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await typeAndWaitForResults(user, 'received');

    const receivedOption = await screen.findByText('Received User');
    const listItem = receivedOption.closest('li')!;
    expect(within(listItem).getByText('Request Received')).toBeInTheDocument();
    expect(listItem).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows no chip for normal users and allows selection', async () => {
    setupHandlers();

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await typeAndWaitForResults(user, 'normal');

    const normalOption = await screen.findByText('Normal User');
    const listItem = normalOption.closest('li')!;
    expect(within(listItem).queryByRole('status')).not.toBeInTheDocument();
    expect(listItem).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('shows friendly message on 409 "Already friends" error and invalidates caches', { timeout: 10000 }, async () => {
    setupHandlers({ users: [normalUser] });
    server.use(
      http.post(`${BASE_URL}/api/friends/request/:userId`, () =>
        HttpResponse.json(
          { statusCode: 409, message: 'Already friends with this user', error: 'Conflict' },
          { status: 409 },
        ),
      ),
    );

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await typeAndWaitForResults(user, 'normal');
    await selectUserAndWaitForButton(user, 'Normal User');

    await user.click(screen.getByRole('button', { name: /send friend request/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You are already friends with this user.',
      );
    });
  });

  it('shows friendly message on 409 "Friend request already sent" error', { timeout: 10000 }, async () => {
    setupHandlers({ users: [normalUser] });
    server.use(
      http.post(`${BASE_URL}/api/friends/request/:userId`, () =>
        HttpResponse.json(
          { statusCode: 409, message: 'Friend request already sent', error: 'Conflict' },
          { status: 409 },
        ),
      ),
    );

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await typeAndWaitForResults(user, 'normal');
    await selectUserAndWaitForButton(user, 'Normal User');

    await user.click(screen.getByRole('button', { name: /send friend request/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You have already sent a friend request to this user.',
      );
    });
  });

  it('shows backend message for non-409 errors', { timeout: 10000 }, async () => {
    setupHandlers({ users: [normalUser] });
    server.use(
      http.post(`${BASE_URL}/api/friends/request/:userId`, () =>
        HttpResponse.json(
          { statusCode: 500, message: 'Internal server error', error: 'Internal Server Error' },
          { status: 500 },
        ),
      ),
    );

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await typeAndWaitForResults(user, 'normal');
    await selectUserAndWaitForButton(user, 'Normal User');

    await user.click(screen.getByRole('button', { name: /send friend request/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Internal server error');
    });
  });

  it('shows success message and clears selection on successful request', { timeout: 10000 }, async () => {
    setupHandlers({ users: [normalUser] });

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await typeAndWaitForResults(user, 'normal');
    await selectUserAndWaitForButton(user, 'Normal User');

    await user.click(screen.getByRole('button', { name: /send friend request/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Friend request sent!');
    });
  });

  it('resets state when dialog is closed', async () => {
    setupHandlers({ users: [normalUser] });

    const { user } = renderWithProviders(<AddFriendDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
