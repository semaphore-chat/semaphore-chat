import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { createChannel } from '../test-utils/factories';
import EditChannelDialog from '../../components/Community/EditChannelDialog';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../components/Community/WebhookManagement', () => ({
  default: () => <div data-testid="webhooks" />,
}));
vi.mock('../../components/Community/ChannelPermissionsTab', () => ({
  default: () => <div data-testid="permissions-tab" />,
}));

const BASE = 'http://localhost:3000';
const channel = createChannel({ id: 'ch-1', name: 'general', communityId: 'community-1' });

function capsWith(managePermissions: boolean) {
  server.use(
    http.get(`${BASE}/api/channels/community/:communityId/permissions/me`, () =>
      HttpResponse.json({
        communityId: 'community-1',
        channels: [
          {
            channelId: 'ch-1',
            view: true,
            post: true,
            attach: true,
            react: true,
            threadReply: true,
            connect: true,
            speak: true,
            video: true,
            share: true,
            managePermissions,
            timedOutUntil: null,
            postingRoleNames: [],
          },
        ],
      })),
  );
}

describe('EditChannelDialog', () => {
  it('shows General and Permissions tabs to someone who manages permissions', async () => {
    capsWith(true);
    const { user } = renderWithProviders(<EditChannelDialog open channel={channel} onClose={vi.fn()} />);
    const tab = await screen.findByRole('tab', { name: 'Permissions' });
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Channel Name')).toHaveValue('general');

    await user.click(tab);
    expect(await screen.findByTestId('permissions-tab')).toBeInTheDocument();
    expect(screen.queryByLabelText('Channel Name')).not.toBeInTheDocument();
  });

  it('shows no tabs (and no privacy switch) to someone who can\'t manage permissions', async () => {
    capsWith(false);
    renderWithProviders(<EditChannelDialog open channel={channel} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Channel Name')).toHaveValue('general'));
    // Let the capabilities settle, then confirm there are still no tabs
    await screen.findByTestId('webhooks');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /private/i })).not.toBeInTheDocument();
  });

  it('the General tab only saves the name', async () => {
    capsWith(true);
    const patches: unknown[] = [];
    server.use(
      http.patch(`${BASE}/api/channels/:id`, async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json(channel);
      }),
    );
    const onClose = vi.fn();
    const { user } = renderWithProviders(<EditChannelDialog open channel={channel} onClose={onClose} />);
    const name = await screen.findByLabelText('Channel Name');
    await user.clear(name);
    await user.type(name, 'lobby');
    await user.click(screen.getByRole('button', { name: /update channel/i }));
    await waitFor(() => expect(patches).toEqual([{ name: 'lobby' }]));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
