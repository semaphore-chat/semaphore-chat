import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders, createMessage, createSpan, createUser } from '../test-utils';
import MessageSearch from '../../components/Message/MessageSearch';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const BASE = 'http://localhost:3000';
const author = createUser({ id: 'u-bo', username: 'bo', displayName: 'Bo' });
const first = createMessage({ id: 'm1', channelId: 'ch1', authorId: author.id, spans: [createSpan({ text: 'deploy one' })] });
const second = createMessage({ id: 'm2', channelId: 'ch1', authorId: author.id, spans: [createSpan({ text: 'deploy two' })] });

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
};

function renderPopover(onClose = vi.fn()) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const result = renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <MessageSearch channelId="ch1" communityId="c1" anchorEl={anchor} onClose={onClose} />
            <LocationProbe />
          </>
        }
      />
    </Routes>,
    { routerProps: { initialEntries: ['/community/c1/channel/ch1'] } },
  );
  return { ...result, onClose };
}

describe('MessageSearch (desktop popover)', () => {
  beforeEach(() => {
    server.use(
      http.get(`${BASE}/api/users/:id`, () => HttpResponse.json(author)),
      http.get(`${BASE}/api/messages/search/channel/:channelId`, ({ request }) => {
        const q = new URL(request.url).searchParams.get('q') ?? '';
        return HttpResponse.json(q.includes('deploy') ? [first, second] : []);
      }),
    );
  });

  it('renders results with the author and shows "No messages found" for misses', async () => {
    const { user } = renderPopover();
    const input = screen.getByPlaceholderText('Search messages...');
    expect(screen.getByText('Type to search messages')).toBeInTheDocument();

    await user.type(input, 'deploy');
    expect(await screen.findByText('deploy one')).toBeInTheDocument();
    expect(screen.getByText('deploy two')).toBeInTheDocument();
    expect((await screen.findAllByText('Bo')).length).toBeGreaterThan(0);

    await user.clear(input);
    await user.type(input, 'nope');
    expect(await screen.findByText('No messages found')).toBeInTheDocument();
  });

  it('ArrowDown + Enter jumps to the selected result with ?highlight and closes', async () => {
    const { user, onClose } = renderPopover();
    const input = screen.getByPlaceholderText('Search messages...');
    await user.type(input, 'deploy');
    await screen.findByText('deploy two');

    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/community/c1/channel/ch1?highlight=m2'),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
