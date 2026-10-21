import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { createUser, renderWithProviders } from '../test-utils';
import TimeoutListPanel from '../../components/Moderation/TimeoutListPanel';
import type { CommunityTimeoutDto } from '../../api-client/types.gen';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../components/Common/UserAvatar', () => ({
  __esModule: true,
  default: ({ userId }: { userId?: string }) => <div data-testid={`avatar-${userId}`} />,
}));

const permissions = vi.hoisted(() => ({ timeout: true }));
vi.mock('../../features/roles/useUserPermissions', () => ({
  useCanPerformAction: (_type: string, _id: string, action: string) =>
    action === 'TIMEOUT_USER' ? permissions.timeout : true,
}));

const TIMEOUT_LIST_URL = 'http://localhost:3000/api/moderation/timeouts/community-1';
const REMOVE_TIMEOUT_URL = 'http://localhost:3000/api/moderation/timeout/community-1/:userId';

function makeTimeout(overrides: Partial<CommunityTimeoutDto> = {}): CommunityTimeoutDto {
  return {
    id: 'timeout-1',
    communityId: 'community-1',
    userId: 'user-target',
    moderatorId: 'mod-1',
    reason: null,
    createdAt: '2025-01-01T12:00:00Z',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    user: createUser({ id: 'user-target', username: 'target_user', displayName: 'Target User' }),
    moderator: null,
    ...overrides,
  };
}

function serveTimeouts(timeouts: CommunityTimeoutDto[]) {
  server.use(http.get(TIMEOUT_LIST_URL, () => HttpResponse.json(timeouts)));
}

describe('TimeoutListPanel', () => {
  beforeEach(() => {
    permissions.timeout = true;
  });

  it('shows skeleton placeholders while loading', async () => {
    server.use(
      http.get(TIMEOUT_LIST_URL, async () => {
        await delay('infinite');
        return HttpResponse.json([]);
      }),
    );

    const { container } = renderWithProviders(<TimeoutListPanel communityId="community-1" />);

    expect(screen.getByText('Active Timeouts')).toBeInTheDocument();
    expect(container.querySelectorAll('.MuiSkeleton-root')).toHaveLength(3);
  });

  it('shows an error alert when timeouts cannot be loaded', async () => {
    server.use(http.get(TIMEOUT_LIST_URL, () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<TimeoutListPanel communityId="community-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load timeout list');
  });

  it('shows the empty state when nobody is timed out', async () => {
    serveTimeouts([]);

    renderWithProviders(<TimeoutListPanel communityId="community-1" />);

    expect(await screen.findByText('No active timeouts')).toBeInTheDocument();
    expect(screen.getByText('Active Timeouts (0)')).toBeInTheDocument();
  });

  it('lists active timeouts and hides expired ones', async () => {
    serveTimeouts([
      makeTimeout({
        id: 'timeout-hours',
        userId: 'user-hours',
        reason: 'Cooling off',
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        user: createUser({ id: 'user-hours', username: 'hours_user', displayName: 'Hours User' }),
      }),
      makeTimeout({
        id: 'timeout-minutes',
        userId: 'user-minutes',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        user: createUser({ id: 'user-minutes', username: 'minutes_user', displayName: 'Minutes User' }),
      }),
      makeTimeout({
        id: 'timeout-seconds',
        userId: 'user-seconds',
        expiresAt: new Date(Date.now() + 30 * 1000).toISOString(),
        user: createUser({ id: 'user-seconds', username: 'seconds_user', displayName: 'Seconds User' }),
      }),
      makeTimeout({
        id: 'timeout-expired',
        userId: 'user-expired',
        expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
        user: createUser({ id: 'user-expired', username: 'expired_user', displayName: 'Expired User' }),
      }),
    ]);

    renderWithProviders(<TimeoutListPanel communityId="community-1" />);

    expect(await screen.findByText('Hours User')).toBeInTheDocument();
    expect(screen.getByText('Active Timeouts (3)')).toBeInTheDocument();
    expect(screen.getByText('Reason: Cooling off')).toBeInTheDocument();
    expect(screen.getByText(/^\d+h \d+m remaining$/)).toBeInTheDocument();
    expect(screen.getByText(/^\d+m \d+s remaining$/)).toBeInTheDocument();
    expect(screen.getByText(/^\d+s remaining$/)).toBeInTheDocument();
    expect(screen.queryByText('Expired User')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Started .*2025/)).toHaveLength(3);
  });

  it('falls back to the username, then to a truncated id', async () => {
    serveTimeouts([
      makeTimeout({
        id: 'timeout-username',
        userId: 'user-nodisplay',
        user: createUser({ id: 'user-nodisplay', username: 'plain_user', displayName: null }),
      }),
      makeTimeout({ id: 'timeout-nouser', userId: 'abcdef1234567890', user: null }),
    ]);

    renderWithProviders(<TimeoutListPanel communityId="community-1" />);

    expect(await screen.findByText('plain_user')).toBeInTheDocument();
    expect(screen.getByText('User abcdef12...')).toBeInTheDocument();
  });

  it('removes a timeout with the entered reason', async () => {
    let removeBody: unknown;
    server.use(
      http.get(TIMEOUT_LIST_URL, () => HttpResponse.json([makeTimeout()])),
      http.delete(REMOVE_TIMEOUT_URL, async ({ request }) => {
        removeBody = await request.json();
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = renderWithProviders(<TimeoutListPanel communityId="community-1" />);

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('heading', { name: 'Remove Timeout' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Reason (optional)'), 'Behaved since');
    await user.click(screen.getByRole('button', { name: 'Remove Timeout' }));

    await waitFor(() => expect(removeBody).toEqual({ reason: 'Behaved since' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove Timeout' })).not.toBeInTheDocument(),
    );
  });

  it('sends no reason when left blank', async () => {
    let removeBody: unknown;
    server.use(
      http.get(TIMEOUT_LIST_URL, () => HttpResponse.json([makeTimeout()])),
      http.delete(REMOVE_TIMEOUT_URL, async ({ request }) => {
        removeBody = await request.json();
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = renderWithProviders(<TimeoutListPanel communityId="community-1" />);

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Remove Timeout' }));

    await waitFor(() => expect(removeBody).toEqual({}));
  });

  it('closes the dialog without removing when Cancel is clicked', async () => {
    let removeCalls = 0;
    server.use(
      http.get(TIMEOUT_LIST_URL, () => HttpResponse.json([makeTimeout()])),
      http.delete(REMOVE_TIMEOUT_URL, () => {
        removeCalls += 1;
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = renderWithProviders(<TimeoutListPanel communityId="community-1" />);

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove Timeout' })).not.toBeInTheDocument(),
    );
    expect(removeCalls).toBe(0);
  });

  it('hides the Remove action without the TIMEOUT_USER permission', async () => {
    permissions.timeout = false;
    serveTimeouts([makeTimeout()]);

    renderWithProviders(<TimeoutListPanel communityId="community-1" />);

    expect(await screen.findByText('Target User')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});
