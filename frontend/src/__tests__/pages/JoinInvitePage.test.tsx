import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import JoinInvitePage from '../../pages/JoinInvitePage';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useParams: () => ({ inviteCode: 'abc123' }),
}));

const lookupAnswers = (response: () => Response) =>
  server.use(http.get('http://localhost:3000/api/invite/public/:code', response));

describe('JoinInvitePage', () => {
  it('shows an unusable invite as invalid, not the signup form', async () => {
    // The lookup answers an empty 200 for a code that can't be used, which the
    // generated client turns into {}.
    lookupAnswers(() => new HttpResponse(null, { status: 200, headers: { 'Content-Length': '0' } }));

    renderWithProviders(<JoinInvitePage />);

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('shows the signup form for a usable invite', async () => {
    lookupAnswers(() =>
      HttpResponse.json({
        code: 'abc123',
        uses: 0,
        maxUses: 5,
        validUntil: null,
        disabled: false,
        createdBy: { username: 'owner' },
      }),
    );

    renderWithProviders(<JoinInvitePage />);

    expect(await screen.findByText('abc123')).toBeInTheDocument();
    expect(screen.queryByText(/invalid or has expired/i)).not.toBeInTheDocument();
  });
});
