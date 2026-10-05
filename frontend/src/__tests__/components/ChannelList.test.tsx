import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import ChannelList from '../../components/Channel/ChannelList';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// Mock the Channel component to isolate ChannelList
vi.mock('../../components/Channel/Channel', () => ({
  Channel: ({ channel }: { channel: { id: string; name: string } }) => (
    <div data-testid={`channel-${channel.id}`}>{channel.name}</div>
  ),
}));

describe('ChannelList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders text and voice channel categories', async () => {
    renderWithProviders(<ChannelList communityId="community-1" />, {
      routerProps: { initialEntries: ['/community/community-1'] },
    });

    await waitFor(() => {
      expect(screen.getByText('Text Channels')).toBeInTheDocument();
    });
    expect(screen.getByText('Voice Channels')).toBeInTheDocument();
    expect(screen.getByText('general')).toBeInTheDocument();
    expect(screen.getByText('voice-chat')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    server.use(
      http.get('http://localhost:3000/api/channels/community/:communityId', () => {
        return HttpResponse.json({ message: 'Server error' }, { status: 500 });
      })
    );

    renderWithProviders(<ChannelList communityId="community-1" />, {
      routerProps: { initialEntries: ['/community/community-1'] },
    });

    await waitFor(() => {
      expect(screen.getByText("Couldn't load channels")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
  });

  it('shows empty state when no channels', async () => {
    server.use(
      http.get('http://localhost:3000/api/channels/community/:communityId', () => {
        return HttpResponse.json([]);
      })
    );

    renderWithProviders(<ChannelList communityId="community-1" />, {
      routerProps: { initialEntries: ['/community/community-1'] },
    });

    await waitFor(() => {
      expect(screen.getByText('No channels yet')).toBeInTheDocument();
    });
  });

  it('hides voice category when only text channels exist', async () => {
    server.use(
      http.get('http://localhost:3000/api/channels/community/:communityId', () => {
        return HttpResponse.json([
          { id: 'ch-1', name: 'general', communityId: 'c1', type: 'TEXT', isPrivate: false, createdAt: '2025-01-01T00:00:00Z', position: 0 },
        ]);
      })
    );

    renderWithProviders(<ChannelList communityId="community-1" />, {
      routerProps: { initialEntries: ['/community/community-1'] },
    });

    await waitFor(() => {
      expect(screen.getByText('Text Channels')).toBeInTheDocument();
    });
    expect(screen.queryByText('Voice Channels')).not.toBeInTheDocument();
  });

  it('hides text category when only voice channels exist', async () => {
    server.use(
      http.get('http://localhost:3000/api/channels/community/:communityId', () => {
        return HttpResponse.json([
          { id: 'vc-1', name: 'voice', communityId: 'c1', type: 'VOICE', isPrivate: false, createdAt: '2025-01-01T00:00:00Z', position: 0 },
        ]);
      })
    );

    renderWithProviders(<ChannelList communityId="community-1" />, {
      routerProps: { initialEntries: ['/community/community-1'] },
    });

    await waitFor(() => {
      expect(screen.getByText('Voice Channels')).toBeInTheDocument();
    });
    expect(screen.queryByText('Text Channels')).not.toBeInTheDocument();
  });

  it('sorts channels by position', async () => {
    server.use(
      http.get('http://localhost:3000/api/channels/community/:communityId', () => {
        return HttpResponse.json([
          { id: 'ch-2', name: 'second', communityId: 'c1', type: 'TEXT', isPrivate: false, createdAt: '2025-01-01T00:00:00Z', position: 2 },
          { id: 'ch-1', name: 'first', communityId: 'c1', type: 'TEXT', isPrivate: false, createdAt: '2025-01-01T00:00:00Z', position: 1 },
        ]);
      })
    );

    renderWithProviders(<ChannelList communityId="community-1" />, {
      routerProps: { initialEntries: ['/community/community-1'] },
    });

    await waitFor(() => {
      expect(screen.getByText('first')).toBeInTheDocument();
    });

    const channels = screen.getAllByText(/first|second/);
    expect(channels[0]).toHaveTextContent('first');
    expect(channels[1]).toHaveTextContent('second');
  });
});
