/**
 * MobileChannelsPanel (phone) and TabletSidebar (tablet) share one community
 * header and pass the channel query state through to ChannelCategoryList.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { renderWithProviders } from '../test-utils';
import { server } from '../msw/server';
import { MobileChannelsPanel } from '../../components/Mobile/Panels/MobileChannelsPanel';
import { TabletSidebar } from '../../components/Mobile/Tablet/TabletSidebar';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const mockNavigateToChat = vi.fn();
const mockOpenDrawer = vi.fn();
vi.mock('../../components/Mobile/Navigation/MobileNavigationContext', () => ({
  useMobileNavigation: () => ({
    state: { channelId: null },
    navigateToChat: mockNavigateToChat,
    openDrawer: mockOpenDrawer,
    goBack: vi.fn(),
  }),
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: false, currentChannelId: null },
    actions: { joinVoiceChannel: vi.fn(), revealVideoTiles: vi.fn() },
  }),
}));

vi.mock('../../components/Voice/VoiceChannelUserList', () => ({
  VoiceChannelUserList: ({ channel }: { channel: { id: string } }) => (
    <div data-testid="voice-user-list" data-channel-id={channel.id} />
  ),
}));

vi.mock('../../hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({
    unreadCount: () => 0,
    mentionCount: (id?: string) => (id === 'ch-1' ? 4 : 0),
    hasUnread: (id?: string) => id === 'ch-1',
    lastReadMessageId: () => undefined,
    allUnreadCounts: [],
  }),
}));

vi.mock('../../features/roles/useUserPermissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanPerformAction: () => false,
}));

vi.mock('../../hooks/useAuthenticatedImage', () => ({
  useAuthenticatedImage: () => ({ blobUrl: null, isLoading: false, error: null }),
}));

const BASE = 'http://localhost:3000';

function mockCommunity() {
  server.use(
    http.get(`${BASE}/api/community/:id`, () =>
      HttpResponse.json({ id: 'community-1', name: 'Nightowl Collective', avatar: null }),
    ),
  );
}

const panels = [
  ['MobileChannelsPanel', () => <MobileChannelsPanel communityId="community-1" />],
  ['TabletSidebar', () => <TabletSidebar communityId="community-1" />],
] as const;

describe.each(panels)('%s', (_name, render) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommunity();
  });

  it('renders the shared community header', async () => {
    renderWithProviders(render());

    await waitFor(() =>
      expect(screen.getByTestId('community-header')).toHaveTextContent('Nightowl Collective'),
    );
    expect(screen.getByRole('button', { name: 'Switch community' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Community options' })).toBeInTheDocument();
  });

  it('shows mention badges and voice participants from the shared row', async () => {
    renderWithProviders(render());

    expect(await screen.findByText('general')).toBeInTheDocument();
    expect(screen.getByTestId('mention-badge')).toHaveTextContent('4');
    expect(screen.getByTestId('voice-user-list')).toHaveAttribute('data-channel-id', 'ch-2');
  });

  it('navigates to the chat screen when a channel is tapped', async () => {
    const { user } = renderWithProviders(render());

    await user.click(await screen.findByText('general'));

    expect(mockNavigateToChat).toHaveBeenCalledWith('community-1', 'ch-1');
  });

  it('shows an error with retry on a 500, then recovers', async () => {
    let fail = true;
    server.use(
      http.get(`${BASE}/api/channels/community/:communityId`, () =>
        fail
          ? HttpResponse.json({ message: 'boom' }, { status: 500 })
          : HttpResponse.json([
              { id: 'ch-1', name: 'general', communityId: 'community-1', type: 'TEXT', isPrivate: false, createdAt: '2025-01-01T00:00:00Z', position: 0 },
            ]),
      ),
    );
    const { user } = renderWithProviders(render());

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load channels/i);
    expect(screen.queryByText('No channels yet')).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('general')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a skeleton while channels load', async () => {
    server.use(
      http.get(`${BASE}/api/channels/community/:communityId`, async () => {
        await delay('infinite');
        return HttpResponse.json([]);
      }),
    );
    renderWithProviders(render());

    expect(await screen.findByTestId('channel-list-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('No channels yet')).not.toBeInTheDocument();
  });
});
