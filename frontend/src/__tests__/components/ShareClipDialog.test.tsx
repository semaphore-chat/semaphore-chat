import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders, createChannel, createDmGroup, createDmGroupMember } from '../test-utils';
import ShareClipDialog from '../../components/Profile/ShareClipDialog';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const COMMUNITIES_URL = 'http://localhost:3000/api/community/mine';
const CHANNELS_URL = 'http://localhost:3000/api/channels/community/:communityId';
const DMS_URL = 'http://localhost:3000/api/direct-messages';
const SHARE_URL = 'http://localhost:3000/api/livekit/clips/:clipId/share';

function serveDestinations() {
  server.use(
    http.get(COMMUNITIES_URL, () =>
      HttpResponse.json([
        { id: 'community-1', name: 'Night Crew', description: null, avatar: null, banner: null, createdAt: '2025-01-01T00:00:00Z' },
      ]),
    ),
    http.get(CHANNELS_URL, () =>
      HttpResponse.json([
        createChannel({ id: 'chat-1', name: 'general', type: 'TEXT' }),
        createChannel({ id: 'voice-1', name: 'voice-chat', type: 'VOICE' }),
        createChannel({ id: 'chat-2', name: 'random', type: 'TEXT', position: 1 }),
      ]),
    ),
    http.get(DMS_URL, () =>
      HttpResponse.json([
        createDmGroup({
          id: 'dm-1',
          isGroup: false,
          members: [
            createDmGroupMember({ userId: 'me', user: { id: 'me', username: 'me', displayName: 'Me', avatarUrl: null } }),
            createDmGroupMember({ userId: 'alice', user: { id: 'alice', username: 'alice', displayName: 'Alice', avatarUrl: null } }),
          ],
        }),
      ]),
    ),
  );
}

/** Open the nth MUI select (0 = community/DM, 1 = channel) and choose an option. */
async function selectOption(user: UserEvent, index: number, optionName: string) {
  await user.click(screen.getAllByRole('combobox')[index]);
  await user.click(await screen.findByRole('option', { name: optionName }));
}

describe('ShareClipDialog', () => {
  const props = { open: true, onClose: vi.fn(), clipId: 'clip-1' };

  beforeEach(() => {
    props.onClose = vi.fn();
  });

  it('defaults to sharing to a channel and loads communities', async () => {
    serveDestinations();

    const { user } = renderWithProviders(<ShareClipDialog {...props} />);

    expect(screen.getByRole('heading', { name: 'Share Clip' })).toBeInTheDocument();
    await selectOption(user, 0, 'Night Crew');
    expect(screen.getByText('Night Crew')).toBeInTheDocument();
  });

  it('loads text channels for the chosen community, hiding voice channels', async () => {
    serveDestinations();

    const { user } = renderWithProviders(<ShareClipDialog {...props} />);
    await selectOption(user, 0, 'Night Crew');
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));

    await user.click(screen.getAllByRole('combobox')[1]);
    expect(await screen.findByRole('option', { name: '#general' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '#random' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '#voice-chat' })).not.toBeInTheDocument();
  });

  it('refuses to share to a channel before one is selected', async () => {
    serveDestinations();

    const { user } = renderWithProviders(<ShareClipDialog {...props} />);
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(await screen.findByText('Please select a channel')).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('shares to the selected channel and closes', async () => {
    let sharePath = '';
    let shareBody: unknown;
    serveDestinations();
    server.use(
      http.post(SHARE_URL, async ({ request, params }) => {
        sharePath = String(params.clipId);
        shareBody = await request.json();
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = renderWithProviders(<ShareClipDialog {...props} />);
    await selectOption(user, 0, 'Night Crew');
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));
    await selectOption(user, 1, '#general');
    await user.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() =>
      expect(shareBody).toEqual({ destination: 'channel', targetChannelId: 'chat-1' }),
    );
    expect(sharePath).toBe('clip-1');
    expect(await screen.findByText('Clip shared successfully')).toBeInTheDocument();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('lists DM conversations and refuses to share before one is selected', async () => {
    serveDestinations();

    const { user } = renderWithProviders(<ShareClipDialog {...props} />);
    await user.click(screen.getByRole('radio', { name: 'Share to DM' }));

    await user.click(screen.getAllByRole('combobox')[0]);
    expect(await screen.findByRole('option', { name: 'me, alice' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(await screen.findByText('Please select a DM conversation')).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('shares to the selected DM conversation', async () => {
    let shareBody: unknown;
    serveDestinations();
    server.use(
      http.post(SHARE_URL, async ({ request }) => {
        shareBody = await request.json();
        return HttpResponse.json({ success: true });
      }),
    );

    const { user } = renderWithProviders(<ShareClipDialog {...props} />);
    await user.click(screen.getByRole('radio', { name: 'Share to DM' }));
    await selectOption(user, 0, 'me, alice');
    await user.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() =>
      expect(shareBody).toEqual({ destination: 'dm', targetDirectMessageGroupId: 'dm-1' }),
    );
    expect(props.onClose).toHaveBeenCalled();
  });

  it('reports a failed share and stays open', async () => {
    serveDestinations();
    server.use(
      http.post(SHARE_URL, () => HttpResponse.json({ message: 'Forbidden' }, { status: 500 })),
    );

    const { user } = renderWithProviders(<ShareClipDialog {...props} />);
    await selectOption(user, 0, 'Night Crew');
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));
    await selectOption(user, 1, '#general');
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('closes without sharing on Cancel', async () => {
    serveDestinations();

    const { user } = renderWithProviders(<ShareClipDialog {...props} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onClose).toHaveBeenCalled();
  });

  it('does not fetch destinations while closed', () => {
    let communitiesRequested = false;
    server.use(
      http.get(COMMUNITIES_URL, () => {
        communitiesRequested = true;
        return HttpResponse.json([]);
      }),
    );

    renderWithProviders(<ShareClipDialog {...props} open={false} />);

    expect(communitiesRequested).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Share Clip' })).not.toBeInTheDocument();
  });
});
