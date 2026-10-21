import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { createUser, renderWithProviders } from '../test-utils';
import ModerationLogsPanel from '../../components/Moderation/ModerationLogsPanel';
import type { ModerationLogDto } from '../../api-client/types.gen';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const LOGS_URL = 'http://localhost:3000/api/moderation/logs/community-1';

function makeLog(overrides: Partial<ModerationLogDto> = {}): ModerationLogDto {
  return {
    id: 'log-1',
    communityId: 'community-1',
    action: 'BAN_USER',
    moderatorId: 'mod-1',
    targetUserId: 'user-target',
    reason: null,
    metadata: null,
    createdAt: '2025-03-04T12:00:00Z',
    moderator: createUser({ id: 'mod-1', username: 'mod_user', displayName: 'Mod User' }),
    targetUser: createUser({ id: 'user-target', username: 'target_user', displayName: 'Target User' }),
    ...overrides,
  };
}

describe('ModerationLogsPanel', () => {
  it('shows skeleton placeholders while loading', async () => {
    server.use(
      http.get(LOGS_URL, async () => {
        await delay('infinite');
        return HttpResponse.json({ logs: [], total: 0 });
      }),
    );

    const { container } = renderWithProviders(<ModerationLogsPanel communityId="community-1" />);

    expect(screen.getByText('Moderation Logs')).toBeInTheDocument();
    expect(container.querySelectorAll('.MuiSkeleton-root')).toHaveLength(5);
  });

  it('shows an error alert when the logs cannot be loaded', async () => {
    server.use(http.get(LOGS_URL, () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<ModerationLogsPanel communityId="community-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load moderation logs');
  });

  it('shows the empty state when there are no logs', async () => {
    server.use(http.get(LOGS_URL, () => HttpResponse.json({ logs: [], total: 0 })));

    renderWithProviders(<ModerationLogsPanel communityId="community-1" />);

    expect(await screen.findByText('No moderation logs found')).toBeInTheDocument();
  });

  it('renders each action with its label and the moderator, target, reason and date', async () => {
    server.use(
      http.get(LOGS_URL, () =>
        HttpResponse.json({
          logs: [
            makeLog({ id: 'log-ban', action: 'BAN_USER', reason: 'Spam' }),
            makeLog({ id: 'log-unban', action: 'UNBAN_USER', targetUserId: null, targetUser: null }),
            makeLog({ id: 'log-delete', action: 'DELETE_MESSAGE', targetUserId: null, targetUser: null }),
            makeLog({ id: 'log-pin', action: 'PIN_MESSAGE', targetUserId: null, targetUser: null }),
          ],
          total: 4,
        }),
      ),
    );

    renderWithProviders(<ModerationLogsPanel communityId="community-1" />);

    expect(await screen.findByText('Ban User')).toBeInTheDocument();
    expect(screen.getByText('Unban User')).toBeInTheDocument();
    expect(screen.getByText('Delete Message')).toBeInTheDocument();
    expect(screen.getByText('Pin Message')).toBeInTheDocument();
    expect(screen.getAllByText('by Mod User')).toHaveLength(4);
    expect(screen.getByText('Target: Target User • Reason: Spam')).toBeInTheDocument();
    expect(screen.getAllByText('No additional details')).toHaveLength(3);
    expect(screen.getAllByText(/2025/).length).toBeGreaterThan(0);
  });

  it('falls back to usernames, ids and a message id when the joined users are missing', async () => {
    const withMessage = {
      ...makeLog({
        id: 'log-message',
        action: 'DELETE_MESSAGE',
        moderatorId: 'mod-nodisplay',
        moderator: createUser({ id: 'mod-nodisplay', username: 'plain_mod', displayName: null }),
        targetUserId: 'abcdef1234567890',
        targetUser: null,
      }),
      targetMessageId: 'message-abcdef123456',
    } as ModerationLogDto;

    server.use(http.get(LOGS_URL, () => HttpResponse.json({ logs: [withMessage], total: 1 })));

    renderWithProviders(<ModerationLogsPanel communityId="community-1" />);

    expect(await screen.findByText('by plain_mod')).toBeInTheDocument();
    expect(screen.getByText('Target: abcdef12... • Message: message-...')).toBeInTheDocument();
  });

  it('filters by action and resets to the first page', async () => {
    const requests: URL[] = [];
    server.use(
      http.get(LOGS_URL, ({ request }) => {
        requests.push(new URL(request.url));
        return HttpResponse.json({ logs: [makeLog()], total: 45 });
      }),
    );

    const { user } = renderWithProviders(<ModerationLogsPanel communityId="community-1" />);
    await screen.findByText('Ban User');

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Kick User' }));

    await waitFor(() => expect(requests[requests.length - 1]?.searchParams.get('action')).toBe('KICK_USER'));
    expect(requests[requests.length - 1]?.searchParams.get('offset')).toBe('0');
  });

  it('requests the next page when the pagination is used', async () => {
    const requests: URL[] = [];
    server.use(
      http.get(LOGS_URL, ({ request }) => {
        requests.push(new URL(request.url));
        return HttpResponse.json({ logs: [makeLog()], total: 45 });
      }),
    );

    const { user } = renderWithProviders(<ModerationLogsPanel communityId="community-1" />);
    await screen.findByText('Ban User');

    await user.click(screen.getByRole('button', { name: /page 2/ }));

    await waitFor(() => expect(requests[requests.length - 1]?.searchParams.get('offset')).toBe('20'));
    expect(requests[requests.length - 1]?.searchParams.get('limit')).toBe('20');
  });

  it('hides the pagination when everything fits on one page', async () => {
    server.use(http.get(LOGS_URL, () => HttpResponse.json({ logs: [makeLog()], total: 5 })));

    renderWithProviders(<ModerationLogsPanel communityId="community-1" />);

    await screen.findByText('Ban User');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
