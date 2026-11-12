import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { ErrorCode } from '@semaphore-chat/shared';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import JoinInvitePage from '../../pages/JoinInvitePage';
import { clearTokens, setAccessToken } from '../../utils/tokenService';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const BASE = 'http://localhost:3000';

const usableInvite = {
  code: 'abc123',
  uses: 0,
  maxUses: 5,
  validUntil: null,
  disabled: false,
  createdBy: { username: 'owner' },
};

const lookupAnswers = (status: number, body: Record<string, unknown>) =>
  server.use(
    // Signed-out visitors try one quiet session refresh.
    http.post(`${BASE}/api/auth/refresh`, () =>
      HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
    ),
    http.get(`${BASE}/api/invite/public/:code`, () =>
      HttpResponse.json(body, { status }),
    ),
  );

const renderJoinPage = () =>
  renderWithProviders(
    <Routes>
      <Route path="/join/:inviteCode" element={<JoinInvitePage />} />
      <Route path="/community/:communityId" element={<div>community page</div>} />
      <Route path="/" element={<div>home page</div>} />
    </Routes>,
    { routerProps: { initialEntries: ['/join/abc123'] } },
  );

describe('JoinInvitePage', () => {
  beforeEach(() => {
    clearTokens();
  });

  it('says why the invite cannot be used, from the 404 reason', async () => {
    lookupAnswers(404, {
      statusCode: 404,
      message: 'This invite has expired.',
      errorCode: ErrorCode.INVITE_EXPIRED,
    });

    renderJoinPage();

    expect(await screen.findByText('This invite has expired.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('shows the generic invalid state for an unknown code', async () => {
    lookupAnswers(404, {
      statusCode: 404,
      message: 'This invite link is invalid.',
      errorCode: ErrorCode.INVITE_NOT_FOUND,
    });

    renderJoinPage();

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
  });

  it('shows the signup form to a signed-out visitor', async () => {
    lookupAnswers(200, usableInvite);

    renderJoinPage();

    expect(await screen.findByText('abc123')).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /join with your account/i }),
    ).not.toBeInTheDocument();
  });

  it('joins with the account when signed in, then opens the first joined community', async () => {
    setAccessToken('access-token');
    lookupAnswers(200, usableInvite);
    server.use(
      http.post(`${BASE}/api/invite/:code/accept`, () =>
        HttpResponse.json({
          joined: [{ id: 'community-1', name: 'One' }],
          skipped: [],
        }),
      ),
    );

    const { user } = renderJoinPage();

    const join = await screen.findByRole('button', {
      name: /join with your account/i,
    });
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();

    await user.click(join);

    expect(await screen.findByText('community page')).toBeInTheDocument();
  });

  it('explains a refusal when joining with the account', async () => {
    setAccessToken('access-token');
    lookupAnswers(200, usableInvite);
    server.use(
      http.post(`${BASE}/api/invite/:code/accept`, () =>
        HttpResponse.json(
          {
            statusCode: 404,
            message: 'This invite has reached its maximum number of uses.',
            errorCode: ErrorCode.INVITE_EXHAUSTED,
          },
          { status: 404 },
        ),
      ),
    );

    const { user } = renderJoinPage();

    await user.click(
      await screen.findByRole('button', { name: /join with your account/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByText('This invite has reached its maximum number of uses.'),
      ).toBeInTheDocument(),
    );
  });
});
