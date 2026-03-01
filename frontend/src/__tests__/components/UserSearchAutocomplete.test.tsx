import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import { Chip } from '@mui/material';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders, createUser } from '../test-utils';
import UserSearchAutocomplete from '../../components/Common/UserSearchAutocomplete';

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
const userAlice = createUser({ id: 'alice-1', username: 'alice', displayName: 'Alice' });
const userBob = createUser({ id: 'bob-1', username: 'bob', displayName: 'Bob' });

function setupHandlers(users = [userAlice, userBob]) {
  server.use(
    http.get(`${BASE_URL}/api/users/profile`, () =>
      HttpResponse.json(currentUser),
    ),
    http.get(`${BASE_URL}/api/users/search`, () =>
      HttpResponse.json(users),
    ),
  );
}

/** Type a search query and wait for debounced results to appear */
async function typeAndWaitForResults(user: ReturnType<typeof import('@testing-library/user-event').default.setup>, query: string) {
  const input = screen.getByLabelText('Search users');
  await user.click(input);
  await user.type(input, query);
  // Wait for debounce (300ms) and results to load
  await waitFor(() => {
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  }, { timeout: 2000 });
}

beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe('UserSearchAutocomplete', () => {
  it('does not fetch results until user types', async () => {
    const searchSpy = vi.fn();
    server.use(
      http.get(`${BASE_URL}/api/users/profile`, () =>
        HttpResponse.json(currentUser),
      ),
      http.get(`${BASE_URL}/api/users/search`, () => {
        searchSpy();
        return HttpResponse.json([userAlice, userBob]);
      }),
    );
    const onChange = vi.fn();

    renderWithProviders(
      <UserSearchAutocomplete value={null} onChange={onChange} />,
    );

    // Initially, no search request should be made
    await waitFor(() => {
      expect(searchSpy).not.toHaveBeenCalled();
    });
  });

  it('fetches results after typing and debounce', async () => {
    setupHandlers();
    const onChange = vi.fn();

    const { user } = renderWithProviders(
      <UserSearchAutocomplete value={null} onChange={onChange} />,
    );

    await typeAndWaitForResults(user, 'ali');

    const aliceOption = await screen.findByText('Alice');
    expect(aliceOption).toBeInTheDocument();
  });

  it('renders options without extra content when renderOptionExtra is not provided', async () => {
    setupHandlers();
    const onChange = vi.fn();

    const { user } = renderWithProviders(
      <UserSearchAutocomplete value={null} onChange={onChange} />,
    );

    await typeAndWaitForResults(user, 'a');

    const aliceOption = await screen.findByText('Alice');
    const listItem = aliceOption.closest('li')!;
    // No chips should appear
    expect(within(listItem).queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders extra content from renderOptionExtra in each option', async () => {
    setupHandlers();
    const onChange = vi.fn();

    const { user } = renderWithProviders(
      <UserSearchAutocomplete
        value={null}
        onChange={onChange}
        renderOptionExtra={(u) =>
          u.id === 'alice-1' ? <Chip label="Special" size="small" data-testid="extra-chip" /> : null
        }
      />,
    );

    await typeAndWaitForResults(user, 'a');

    const aliceOption = await screen.findByText('Alice');
    const aliceItem = aliceOption.closest('li')!;
    expect(within(aliceItem).getByText('Special')).toBeInTheDocument();

    // Bob should not have the chip
    const bobOption = screen.getByText('Bob');
    const bobItem = bobOption.closest('li')!;
    expect(within(bobItem).queryByText('Special')).not.toBeInTheDocument();
  });

  it('disables options via getOptionDisabled', async () => {
    setupHandlers();
    const onChange = vi.fn();

    const { user } = renderWithProviders(
      <UserSearchAutocomplete
        value={null}
        onChange={onChange}
        getOptionDisabled={(u) => u.id === 'alice-1'}
      />,
    );

    await typeAndWaitForResults(user, 'a');

    const aliceOption = await screen.findByText('Alice');
    const aliceItem = aliceOption.closest('li')!;
    expect(aliceItem).toHaveAttribute('aria-disabled', 'true');

    const bobOption = screen.getByText('Bob');
    const bobItem = bobOption.closest('li')!;
    expect(bobItem).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('allows selection of non-disabled options', async () => {
    setupHandlers();
    const onChange = vi.fn();

    const { user } = renderWithProviders(
      <UserSearchAutocomplete
        value={null}
        onChange={onChange}
        getOptionDisabled={(u) => u.id === 'alice-1'}
      />,
    );

    await typeAndWaitForResults(user, 'b');

    const bobOption = await screen.findByText('Bob');
    await user.click(bobOption);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bob-1', username: 'bob' }),
    );
  });

  it('works in multiple mode with getOptionDisabled and renderOptionExtra', async () => {
    setupHandlers();
    const onChange = vi.fn();

    const { user } = renderWithProviders(
      <UserSearchAutocomplete
        value={[]}
        onChange={onChange}
        multiple
        getOptionDisabled={(u) => u.id === 'alice-1'}
        renderOptionExtra={(u) =>
          u.id === 'alice-1' ? <Chip label="Disabled" size="small" /> : null
        }
      />,
    );

    await typeAndWaitForResults(user, 'a');

    const aliceOption = await screen.findByText('Alice');
    const aliceItem = aliceOption.closest('li')!;
    expect(aliceItem).toHaveAttribute('aria-disabled', 'true');
    expect(within(aliceItem).getByText('Disabled')).toBeInTheDocument();
  });

  it('excludes current user from results by default', async () => {
    setupHandlers([currentUser, userAlice, userBob]);
    const onChange = vi.fn();

    const { user } = renderWithProviders(
      <UserSearchAutocomplete value={null} onChange={onChange} />,
    );

    await typeAndWaitForResults(user, 'test');

    // Current user should be filtered out
    await screen.findByText('Alice');
    expect(screen.queryByText('Test User')).not.toBeInTheDocument();
  });

  it('excludes specified user IDs from results', async () => {
    setupHandlers();
    const onChange = vi.fn();

    const { user } = renderWithProviders(
      <UserSearchAutocomplete
        value={null}
        onChange={onChange}
        excludeUserIds={['alice-1']}
      />,
    );

    await typeAndWaitForResults(user, 'a');

    await screen.findByText('Bob');
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

});
