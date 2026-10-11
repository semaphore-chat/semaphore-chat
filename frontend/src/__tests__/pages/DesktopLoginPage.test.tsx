import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import DesktopLoginPage from '../../pages/DesktopLoginPage';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const mockLogout = vi.fn();
vi.mock('../../hooks/useLogout', () => ({
  useLogout: () => ({ handleLogout: mockLogout, logoutLoading: false }),
}));

const mockUser = vi.fn();
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUser(),
}));

const challenge = 'c'.repeat(43);
const state = 's'.repeat(43);
const code = 'k'.repeat(43);
const query = `challenge=${challenge}&state=${state}&port=51234`;

function renderPage(search = query) {
  const redirect = vi.fn();
  const result = renderWithProviders(<DesktopLoginPage redirect={redirect} />, {
    routerProps: { initialEntries: [`/desktop-login?${search}`] },
  });
  return { ...result, redirect };
}

describe('DesktopLoginPage', () => {
  let authorizeBody: unknown;

  beforeEach(() => {
    mockLogout.mockReset();
    mockUser.mockReturnValue({
      user: { id: 'u1', username: 'alice', displayName: 'Alice Liddell' },
      isLoading: false,
    });
    authorizeBody = undefined;
    server.use(
      http.post('http://localhost:3000/api/auth/desktop/authorize', async ({ request }) => {
        authorizeBody = await request.json();
        return HttpResponse.json({ code, expiresInSeconds: 60 });
      }),
    );
  });

  it('asks before signing the app in, naming the account', () => {
    const { redirect } = renderPage();

    expect(screen.getByRole('heading', { name: /sign in to the desktop app\?/i })).toBeInTheDocument();
    expect(screen.getByText(/will be signed in as/i)).toHaveTextContent(
      'The Semaphore Chat app on this computer will be signed in as Alice Liddell (@alice).',
    );
    expect(screen.getByText(/Not Alice Liddell\?/)).toBeInTheDocument();
    expect(screen.getByText(/never continue from a link someone sent you/i)).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('on confirm, mints a code for the challenge and hands it to the app over loopback', async () => {
    const { user, redirect } = renderPage();

    await user.click(screen.getByRole('button', { name: /^sign in to the desktop app$/i }));

    await waitFor(() => {
      expect(redirect).toHaveBeenCalledWith(
        `http://127.0.0.1:51234/callback?code=${code}&state=${state}`,
      );
    });
    expect(authorizeBody).toEqual({ codeChallenge: challenge, codeChallengeMethod: 'S256' });
    expect(screen.getByRole('heading', { name: /return to the desktop app/i })).toBeInTheDocument();
  });

  it('shows an error and stays put when approving fails', async () => {
    server.use(
      http.post('http://localhost:3000/api/auth/desktop/authorize', () =>
        HttpResponse.json({ message: 'nope' }, { status: 401 }),
      ),
    );
    const { user, redirect } = renderPage();

    await user.click(screen.getByRole('button', { name: /^sign in to the desktop app$/i }));

    expect(await screen.findByText(/couldn.t approve the sign-in/i)).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('cancel tells the app to stop waiting', async () => {
    const { user, redirect } = renderPage();

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(redirect).toHaveBeenCalledWith(
      `http://127.0.0.1:51234/callback?error=access_denied&state=${state}`,
    );
    expect(screen.getByRole('heading', { name: /sign-in cancelled/i })).toBeInTheDocument();
  });

  it('"Not you?" signs out and comes back here after the next sign-in', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: /sign out and use another account/i }));

    expect(mockLogout).toHaveBeenCalledWith({ returnTo: `/desktop-login?${query}` });
  });

  it('refuses a broken link without calling the server', () => {
    const { redirect } = renderPage(`challenge=short&state=${state}&port=51234`);

    expect(screen.getByRole('heading', { name: /this sign-in link doesn.t work/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in to the desktop app/i })).not.toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('replaces the history entry when handing over, so Back skips the code', async () => {
    const replace = vi.fn();
    const assign = vi.fn();
    const location = vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      replace,
      assign,
    } as Location);
    try {
      const { user } = renderWithProviders(<DesktopLoginPage />, {
        routerProps: { initialEntries: [`/desktop-login?${query}`] },
      });
      await user.click(screen.getByRole('button', { name: /^sign in to the desktop app$/i }));
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith(
          `http://127.0.0.1:51234/callback?code=${code}&state=${state}`,
        ),
      );
      expect(assign).not.toHaveBeenCalled();
    } finally {
      location.mockRestore();
    }
  });
});
