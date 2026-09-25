import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { ReactionTooltip } from '../../components/Message/ReactionTooltip';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const BASE_URL = 'http://localhost:3000';

function mockUsers() {
  server.use(
    http.get(`${BASE_URL}/api/users/:id`, ({ params }) =>
      HttpResponse.json({ id: params.id, username: `name-${params.id}`, displayName: null }),
    ),
  );
}

async function hover(userIds: string[] | null) {
  mockUsers();
  const { user } = renderWithProviders(
    <ReactionTooltip userIds={userIds}>
      <button type="button">reaction</button>
    </ReactionTooltip>,
  );
  await user.hover(screen.getByRole('button', { name: 'reaction' }));
  return screen.findByRole('tooltip');
}

describe('ReactionTooltip', () => {
  it('lists every reactor when there are 15 or fewer', async () => {
    const ids = Array.from({ length: 3 }, (_, i) => `u${i}`);
    const tooltip = await hover(ids);

    for (const id of ids) {
      expect(await screen.findByText(`name-${id}`)).toBeInTheDocument();
    }
    expect(tooltip).not.toHaveTextContent(/more/);
  });

  it('shows the first 15 reactors and a "+N more" line for the rest', async () => {
    const ids = Array.from({ length: 18 }, (_, i) => `u${i}`);
    const tooltip = await hover(ids);

    expect(await screen.findByText('name-u14')).toBeInTheDocument();
    expect(screen.queryByText('name-u15')).not.toBeInTheDocument();
    expect(tooltip).toHaveTextContent('+3 more');
  });

  it('tolerates a missing userIds list', async () => {
    const tooltip = await hover(null);

    expect(tooltip).not.toHaveTextContent(/more/);
  });
});
