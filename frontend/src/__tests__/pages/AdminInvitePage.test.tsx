import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import AdminInvitePage from '../../pages/AdminInvitePage';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', role: 'USER' }, isLoading: false }),
}));
vi.mock('../../features/roles/useUserPermissions', () => ({
  useUserPermissions: () => ({ hasPermissions: true, isLoading: false }),
}));

const community = (id: string, name: string) => ({
  id,
  name,
  description: null,
  avatar: null,
  banner: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('AdminInvitePage create dialog', () => {
  beforeEach(() => {
    server.use(
      http.get('http://localhost:3000/api/invite', () => HttpResponse.json([])),
      http.get('http://localhost:3000/api/community/mine', () =>
        HttpResponse.json([community('held', 'Alpha'), community('lacking', 'Beta')]),
      ),
      http.get('http://localhost:3000/api/roles/my/community/:communityId', ({ params }) =>
        HttpResponse.json({
          userId: 'me',
          resourceId: params.communityId,
          resourceType: 'COMMUNITY',
          roles: [{ id: 'r', name: 'Role', actions: params.communityId === 'held' ? ['CREATE_INVITE'] : [] }],
        }),
      ),
    );
  });

  it('pre-selects only communities the user can invite to', async () => {
    const { user } = renderWithProviders(<AdminInvitePage />);
    await user.click(await screen.findByRole('button', { name: /create invite/i }));
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: /alpha/i })).toBeChecked());
    expect(within(dialog).getByRole('checkbox', { name: /beta/i })).not.toBeChecked();
  });
});
