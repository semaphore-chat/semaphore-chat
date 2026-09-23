import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { screen, within, waitFor } from '@testing-library/react';
import { Routes, Route, useLocation, MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import {
  renderWithProviders,
  createMessage,
  createSpan,
  createChannel,
  createUser,
  createTestQueryClient,
} from '../test-utils';
import { renderInEveryTheme } from '../test-utils/themeMatrix';
import { MobileScreenContainer } from '../../components/Mobile/Screens/MobileScreenContainer';
import { MobileSearchScreen } from '../../components/Mobile/Screens/MobileSearchScreen';
import { MobileNavigationProvider } from '../../components/Mobile/Navigation/MobileNavigationContext';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// The chat screen itself is heavy (message list, composer, LiveKit). We only
// need to know that navigation landed on it, and with which channel.
// It exposes a stand-in for the app-bar Search button (a push, as the real one
// does) so the chat → search → result → back flow can be driven end to end.
vi.mock('../../components/Mobile/Panels/MobileChatPanel', async () => {
  const { useNavigate } = await import('react-router-dom');
  const { useMobileNavigation } = await import('../../components/Mobile/Navigation/MobileNavigationContext');
  return {
    MobileChatPanel: ({ communityId, channelId }: { communityId?: string; channelId?: string }) => {
      const navigate = useNavigate();
      const { goBack } = useMobileNavigation();
      return (
        <div data-testid="chat-panel">
          chat {channelId}
          <button onClick={() => navigate(`/community/${communityId}/channel/${channelId}/search`)}>
            Open search
          </button>
          <button onClick={goBack}>Chat back</button>
        </div>
      );
    },
  };
});

const BASE = 'http://localhost:3000';

const author = createUser({ id: 'u-ava', username: 'ava', displayName: 'Ava Lindqvist' });
const general = createChannel({ id: 'ch1', communityId: 'c1', name: 'general' });

const deployMsg = createMessage({
  id: 'm-deploy',
  channelId: 'ch1',
  authorId: author.id,
  spans: [createSpan({ text: 'the deploy went out at noon' })],
});
const otherChannelMsg = {
  ...createMessage({
    id: 'm-other',
    channelId: 'ch2',
    authorId: author.id,
    spans: [createSpan({ text: 'deploy checklist lives here' })],
  }),
  channelName: 'ops',
};

let channelSearchCalls: string[] = [];

function useSearchHandlers() {
  server.use(
    http.get(`${BASE}/api/channels/:id`, () => HttpResponse.json(general)),
    http.get(`${BASE}/api/users/:id`, () => HttpResponse.json(author)),
    http.get(`${BASE}/api/messages/search/channel/:channelId`, ({ request }) => {
      const q = new URL(request.url).searchParams.get('q') ?? '';
      channelSearchCalls.push(q);
      return HttpResponse.json(q.includes('deploy') ? [deployMsg] : []);
    }),
    http.get(`${BASE}/api/messages/search/community/:communityId`, ({ request }) => {
      const q = new URL(request.url).searchParams.get('q') ?? '';
      return HttpResponse.json(q.includes('deploy') ? [otherChannelMsg] : []);
    }),
  );
}

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
};

function renderMobileAt(path: string) {
  return renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <MobileNavigationProvider>
            <MobileScreenContainer />
            <LocationProbe />
          </MobileNavigationProvider>
        }
      />
    </Routes>,
    { routerProps: { initialEntries: [path] } },
  );
}

const SEARCH_PATH = '/community/c1/channel/ch1/search';

describe('MobileSearchScreen', () => {
  beforeEach(() => {
    channelSearchCalls = [];
    useSearchHandlers();
  });

  it('renders a full-screen search with the field autofocused', async () => {
    renderMobileAt(SEARCH_PATH);
    const input = await screen.findByRole('searchbox', { name: /search messages/i });
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByLabelText('Go back')).toBeInTheDocument();
    // Placeholder names the channel once it loads
    await waitFor(() => expect(input).toHaveAttribute('placeholder', 'Search #general'));
  });

  it('queries the channel search endpoint and renders results', async () => {
    const { user } = renderMobileAt(SEARCH_PATH);
    const input = await screen.findByRole('searchbox', { name: /search messages/i });
    await user.type(input, 'deploy');

    const results = await screen.findByRole('list', { name: /search results/i });
    expect(within(results).getByText('the deploy went out at noon')).toBeInTheDocument();
    expect(await within(results).findByText('Ava Lindqvist')).toBeInTheDocument();
    expect(channelSearchCalls).toContain('deploy');
  });

  it('shows a no-results state when nothing matches', async () => {
    const { user } = renderMobileAt(SEARCH_PATH);
    const input = await screen.findByRole('searchbox', { name: /search messages/i });
    await user.type(input, 'zzz');
    expect(await screen.findByText(/no messages found/i)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /search results/i })).not.toBeInTheDocument();
  });

  it('shows an error with retry (not "No messages found") when the search fails', async () => {
    let fail = true;
    server.use(
      http.get(`${BASE}/api/messages/search/channel/:channelId`, () =>
        fail
          ? HttpResponse.json({ statusCode: 500, message: 'Internal server error' }, { status: 500 })
          : HttpResponse.json([deployMsg]),
      ),
    );
    const { user } = renderMobileAt(SEARCH_PATH);
    const input = await screen.findByRole('searchbox', { name: /search messages/i });
    await user.type(input, 'deploy');

    expect(await screen.findByText("Couldn't search messages")).toBeInTheDocument();
    expect(screen.queryByText(/no messages found/i)).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole('button', { name: /try again/i }));
    const results = await screen.findByRole('list', { name: /search results/i });
    expect(within(results).getByText('the deploy went out at noon')).toBeInTheDocument();
  });

  it('runs the query from ?q= on load (so back from a result restores it)', async () => {
    renderMobileAt(`${SEARCH_PATH}?q=deploy`);
    const input = await screen.findByRole('searchbox', { name: /search messages/i });
    expect(input).toHaveValue('deploy');
    expect(await screen.findByText('the deploy went out at noon')).toBeInTheDocument();
  });

  it('tapping a result opens the chat with ?highlight=<messageId>', async () => {
    const { user } = renderMobileAt(SEARCH_PATH);
    await user.type(await screen.findByRole('searchbox', { name: /search messages/i }), 'deploy');
    await user.click(await screen.findByText('the deploy went out at noon'));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/community/c1/channel/ch1?highlight=m-deploy'),
    );
    expect(await screen.findByTestId('chat-panel')).toHaveTextContent('chat ch1');
  });

  it('searches all channels and jumps to the other channel', async () => {
    const { user } = renderMobileAt(SEARCH_PATH);
    await user.click(await screen.findByRole('button', { name: 'All Channels' }));
    await user.type(screen.getByRole('searchbox', { name: /search messages/i }), 'deploy');

    expect(await screen.findByText('#ops')).toBeInTheDocument();
    await user.click(screen.getByText('deploy checklist lives here'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/community/c1/channel/ch2?highlight=m-other'),
    );
  });

  it('back returns to the chat', async () => {
    const { user } = renderMobileAt(SEARCH_PATH);
    await screen.findByRole('searchbox', { name: /search messages/i });
    await user.click(screen.getByLabelText('Go back'));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/community\/c1\/channel\/ch1$/));
    expect(await screen.findByTestId('chat-panel')).toHaveTextContent('chat ch1');
  });

  it('chat → search → result → back restores the search, back again returns to the chat', async () => {
    // MemoryRouter doesn't touch window.history, so tell goBack there is
    // in-app history to pop (as there is after these pushes in a browser).
    const stateSpy = vi.spyOn(window.history, 'state', 'get').mockReturnValue({ idx: 1 });
    try {
      const { user } = renderMobileAt('/community/c1/channel/ch1');
      await user.click(await screen.findByRole('button', { name: 'Open search' }));

      await user.type(await screen.findByRole('searchbox', { name: /search messages/i }), 'deploy');
      // ?q= is mirrored (replace) once the debounce settles
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`${SEARCH_PATH}?q=deploy`));
      await user.click(await screen.findByText('the deploy went out at noon'));
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/community/c1/channel/ch1?highlight=m-deploy'),
      );

      // Back from the highlighted message: search is restored with its results
      await user.click(await screen.findByRole('button', { name: 'Chat back' }));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`${SEARCH_PATH}?q=deploy`));
      expect(await screen.findByRole('searchbox', { name: /search messages/i })).toHaveValue('deploy');
      expect(await screen.findByText('the deploy went out at noon')).toBeInTheDocument();

      // Back from search: the original chat (no highlight)
      await user.click(screen.getByLabelText('Go back'));
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(/^\/community\/c1\/channel\/ch1$/),
      );
      expect(await screen.findByTestId('chat-panel')).toHaveTextContent('chat ch1');
    } finally {
      stateSpy.mockRestore();
    }
  });

  it('names the scope generically until the channel loads (never mislabels This Channel)', async () => {
    server.use(http.get(`${BASE}/api/channels/:id`, () => new Promise<Response>(() => {})));
    renderMobileAt(SEARCH_PATH);
    const input = await screen.findByRole('searchbox', { name: /search messages/i });
    expect(input).toHaveAttribute('placeholder', 'Search this channel');
    expect(screen.getByText('Find messages in this channel.')).toBeInTheDocument();
    expect(screen.queryByText(/across every channel/i)).not.toBeInTheDocument();
  });

  it('scope toggle buttons meet the 44px touch-target minimum', async () => {
    renderMobileAt(SEARCH_PATH);
    const btn = await screen.findByRole('button', { name: 'This Channel' });
    expect(getComputedStyle(btn).minHeight).toBe('44px');
    expect(getComputedStyle(screen.getByRole('button', { name: 'All Channels' })).minHeight).toBe('44px');
  });

  it('renders in every theme without throwing', () => {
    renderInEveryTheme(
      () => (
        <QueryClientProvider client={createTestQueryClient()}>
          <MemoryRouter initialEntries={[SEARCH_PATH]}>
            <MobileNavigationProvider>
              <MobileSearchScreen communityId="c1" channelId="ch1" />
            </MobileNavigationProvider>
          </MemoryRouter>
        </QueryClientProvider>
      ),
      (result) => {
        expect(result.getByRole('searchbox', { name: /search messages/i })).toBeInTheDocument();
      },
    );
  });
});
