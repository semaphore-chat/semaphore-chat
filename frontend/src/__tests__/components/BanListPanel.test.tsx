import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { createUser, renderWithProviders } from '../test-utils';
import BanListPanel from '../../components/Moderation/BanListPanel';
import type { CommunityBanDto } from '../../api-client/types.gen';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// The panel only needs the id; the real avatar needs a FileCacheProvider.
vi.mock('../../components/Common/UserAvatar', () => ({
  __esModule: true,
  default: ({ userId }: { userId?: string }) => <div data-testid={`avatar-${userId}`} />,
}));

const permissions = vi.hoisted(() => ({ unban: true }));
vi.mock('../../features/roles/useUserPermissions', () => ({
  useCanPerformAction: (_type: string, _id: string, action: string) =>
    action === 'UNBAN_USER' ? permissions.unban : true,
}));

const BAN_LIST_URL = 'http://localhost:3000/api/moderation/bans/community-1';
const UNBAN_URL = 'http://localhost:3000/api/moderation/ban/community-1/:userId';

function makeBan(overrides: Partial<CommunityBanDto> = {}): CommunityBanDto {
  return {
    id: 'ban-1',
    communityId: 'community-1',
    userId: 'user-target',
    moderatorId: 'mod-1',
    reason: null,
    createdAt: '2025-01-01T12:00:00Z',
    expiresAt: null,
    active: true,
    user: createUser({ id: 'user-target', username: 'target_user', displayName: 'Target User' }),
    moderator: null,
    ...overrides,
  };
}

function serveBans(bans: CommunityBanDto[]) {
  server.use(http.get(BAN_LIST_URL, () => HttpResponse.json(bans)));
}

describe('BanListPanel', () => {
  beforeEach(() => {
    permissions.unban = true;
  });

  it('shows skeleton placeholders while loading', async () => {
    server.use(
      http.get(BAN_LIST_URL, async () => {
        await delay('infinite');
        return HttpResponse.json([]);
      }),
    );

    const { container } = renderWithProviders(<BanListPanel communityId="community-1" />);

    expect(screen.getByText('Ban List')).toBeInTheDocument();
    expect(container.querySelectorAll('.MuiSkeleton-root')).toHaveLength(3);
  });

  it('shows an error alert when the ban list cannot be loaded', async () => {
    server.use(http.get(BAN_LIST_URL, () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<BanListPanel communityId="community-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load ban list');
  });

  it('shows the empty state when nobody is banned', async () => {
    serveBans([]);

    renderWithProviders(<BanListPanel communityId="community-1" />);

    expect(await screen.findByText('No banned users')).toBeInTheDocument();
    expect(screen.getByText('Ban List (0)')).toBeInTheDocument();
  });

  it('lists active bans with their reason, status and the date', async () => {
    serveBans([
      makeBan({
        id: 'ban-permanent',
        userId: 'user-perm',
        reason: 'Repeated spam',
        expiresAt: null,
        user: createUser({ id: 'user-perm', username: 'perm_user', displayName: 'Perm User' }),
      }),
      makeBan({
        id: 'ban-temporary',
        userId: 'user-temp',
        createdAt: '2025-02-03T12:00:00Z',
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        user: createUser({ id: 'user-temp', username: 'temp_user', displayName: 'Temp User' }),
      }),
      makeBan({ id: 'ban-inactive', active: false, userId: 'user-gone' }),
    ]);

    renderWithProviders(<BanListPanel communityId="community-1" />);

    expect(await screen.findByText('Perm User')).toBeInTheDocument();
    expect(screen.getByText('Ban List (2)')).toBeInTheDocument();
    expect(screen.getByText('Reason: Repeated spam')).toBeInTheDocument();
    expect(screen.getByText('Permanent')).toBeInTheDocument();
    expect(screen.getByText(/^Expires /)).toBeInTheDocument();
    expect(screen.getAllByText(/Banned .*2025/)).toHaveLength(2);
    // Inactive bans are not listed.
    expect(screen.queryByText('user-gone')).not.toBeInTheDocument();
  });

  it('marks an active ban whose expiry has passed as expired', async () => {
    serveBans([
      makeBan({
        expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        user: createUser({ id: 'user-target', username: 'target_user', displayName: 'Target User' }),
      }),
    ]);

    renderWithProviders(<BanListPanel communityId="community-1" />);

    expect(await screen.findByText('Expired')).toBeInTheDocument();
  });

  it('falls back to the username, then to a truncated id, when the user object is missing', async () => {
    serveBans([
      makeBan({
        id: 'ban-username',
        userId: 'user-nodisplay',
        user: createUser({ id: 'user-nodisplay', username: 'plain_user', displayName: null }),
      }),
      makeBan({ id: 'ban-nouser', userId: 'abcdef1234567890', user: null }),
    ]);

    renderWithProviders(<BanListPanel communityId="community-1" />);

    expect(await screen.findByText('plain_user')).toBeInTheDocument();
    expect(screen.getByText('User abcdef12...')).toBeInTheDocument();
  });

  it('unbans a user with the entered reason and closes the dialog', async () => {
    let unbanBody: unknown;
    server.use(
      http.get(BAN_LIST_URL, () => HttpResponse.json([makeBan()])),
      http.delete(UNBAN_URL, async ({ request }) => {
        unbanBody = await request.json();
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = renderWithProviders(<BanListPanel communityId="community-1" />);

    await user.click(await screen.findByRole('button', { name: 'Unban' }));
    expect(screen.getByRole('heading', { name: 'Unban User' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Reason (optional)'), 'Appeal accepted');
    await user.click(screen.getByRole('button', { name: 'Unban User' }));

    await waitFor(() => expect(unbanBody).toEqual({ reason: 'Appeal accepted' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Unban User' })).not.toBeInTheDocument(),
    );
  });

  it('sends no reason when the unban reason is left blank', async () => {
    let unbanBody: unknown;
    server.use(
      http.get(BAN_LIST_URL, () => HttpResponse.json([makeBan()])),
      http.delete(UNBAN_URL, async ({ request }) => {
        unbanBody = await request.json();
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = renderWithProviders(<BanListPanel communityId="community-1" />);

    await user.click(await screen.findByRole('button', { name: 'Unban' }));
    await user.click(screen.getByRole('button', { name: 'Unban User' }));

    await waitFor(() => expect(unbanBody).toEqual({}));
  });

  it('closes the dialog without unbanning when Cancel is clicked', async () => {
    let unbanCalls = 0;
    server.use(
      http.get(BAN_LIST_URL, () => HttpResponse.json([makeBan()])),
      http.delete(UNBAN_URL, () => {
        unbanCalls += 1;
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = renderWithProviders(<BanListPanel communityId="community-1" />);

    await user.click(await screen.findByRole('button', { name: 'Unban' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Unban User' })).not.toBeInTheDocument(),
    );
    expect(unbanCalls).toBe(0);
  });

  it('hides the Unban action without the UNBAN_USER permission', async () => {
    permissions.unban = false;
    serveBans([makeBan()]);

    renderWithProviders(<BanListPanel communityId="community-1" />);

    expect(await screen.findByText('Target User')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unban' })).not.toBeInTheDocument();
  });
});
