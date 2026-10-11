import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import LoginPage from '../../pages/LoginPage';
import { getAccessToken, clearTokens } from '../../utils/tokenService';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { addServer } from '../../utils/serverStorage';
import { pkceChallenge } from '../../utils/pkce';
import { requestBrowserLoginOnLoad } from '../../hooks/useBrowserLogin';
import type { BrowserLoginResult } from '../../types/electron-api';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

describe('LoginPage', () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    mockNavigate.mockReset();
  });

  it('renders login form with heading, fields, and register link', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole('heading', { name: /login/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /register/i })).toHaveAttribute('href', '/register');
  });

  it('stores tokens and navigates on successful login', async () => {
    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), 'testuser');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(getAccessToken()).toBe('mock-access-token');
    });
    expect(localStorage.getItem('refreshToken')).toBe('mock-refresh-token');
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('stores token as plain string readable by getAccessToken() (cross-module contract)', async () => {
    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), 'testuser');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(getAccessToken()).toBe('mock-access-token');
    });
  });

  it('shows error alert on failed login', async () => {
    server.use(
      http.post('http://localhost:3000/api/auth/login', () => {
        return HttpResponse.json({ message: 'Invalid' }, { status: 401 });
      })
    );

    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), 'baduser');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Login failed. Please try again.');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not show a "Forgot password?" link when the feature is disabled', async () => {
    server.use(
      http.get('http://localhost:3000/api/instance/settings/public', () =>
        HttpResponse.json({
          name: 'Semaphore Chat',
          registrationMode: 'OPEN',
          maxFileSizeBytes: 524288000,
          passwordResetEnabled: false,
        }),
      ),
    );

    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      expect(screen.queryByLabelText('Forgot password?')).not.toBeInTheDocument();
    });
  });

  it('shows a "Forgot password?" link when the feature is enabled', async () => {
    server.use(
      http.get('http://localhost:3000/api/instance/settings/public', () =>
        HttpResponse.json({
          name: 'Semaphore Chat',
          registrationMode: 'OPEN',
          maxFileSizeBytes: 524288000,
          passwordResetEnabled: true,
        }),
      ),
    );

    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Forgot password?')).toHaveAttribute(
        'href',
        '/forgot-password',
      );
    });
  });

  it('shows loading spinner during submission', async () => {
    // Delay the response to catch the loading state
    server.use(
      http.post('http://localhost:3000/api/auth/login', async () => {
        await new Promise(r => setTimeout(r, 100));
        return HttpResponse.json({ accessToken: 'tok', refreshToken: 'rtok' });
      })
    );

    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/username/i), 'testuser');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /login/i }));

    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  describe('after the server signed the user out', () => {
    const renderSignedOut = (signOutReason?: string) =>
      renderWithProviders(<LoginPage />, {
        routerProps: {
          initialEntries: [{ pathname: '/login', state: { signOutReason } }],
        },
      });

    it.each([
      ['PASSWORD_CHANGED', 'Your password was changed, so you were signed out. Sign in with the new password.'],
      ['ACCOUNT_BANNED', 'You were signed out because this account was banned.'],
      ['ACCOUNT_DELETED', 'You were signed out because this account was deleted.'],
    ])('explains %s', (reason, message) => {
      renderSignedOut(reason);

      expect(screen.getByRole('status')).toHaveTextContent(message);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each(['LOGGED_OUT', 'SESSION_REVOKED', 'TOKEN_EXPIRED', undefined])(
      'says nothing for %s',
      (reason) => {
        renderSignedOut(reason);

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      },
    );

    it('shows a failed login instead of the reason', async () => {
      server.use(
        http.post('http://localhost:3000/api/auth/login', () =>
          HttpResponse.json({ message: 'Invalid' }, { status: 401 }),
        ),
      );
      const { user } = renderSignedOut('PASSWORD_CHANGED');

      await user.type(screen.getByLabelText(/username/i), 'testuser');
      await user.type(screen.getByLabelText(/password/i), 'old-password');
      await user.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Login failed');
      });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('desktop app: sign in with browser', () => {
    const CODE = 'k'.repeat(43);

    beforeEach(() => {
      addServer('My Server', 'https://chat.example.com');
      sessionStorage.clear();
    });

    /** Render as the desktop app; `result` is what main hands back. */
    function renderDesktop(result: Promise<BrowserLoginResult>) {
      const api = createFakeElectronAPI({
        startBrowserLogin: vi.fn((_req: { instanceUrl: string; codeChallenge: string }) => result),
        cancelBrowserLogin: vi.fn(() => Promise.resolve()),
        storeRefreshToken: vi.fn(() => Promise.resolve({ stored: true, availability: 'available' as const })),
      });
      // isElectron() for the API base URL and the active server
      setElectronAPIOverride(api);
      return { api, ...renderWithProviders(<LoginPage />, { electronAPI: api }) };
    }

    it('offers it first, shows the server, keeps the password form', async () => {
      renderDesktop(new Promise(() => {}));

      expect(await screen.findByRole('button', { name: /sign in with browser/i })).toBeInTheDocument();
      expect(screen.getByText('My Server')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /change server/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^login$/i })).toBeInTheDocument();
    });

    it('is hidden when the server is too old to support it', async () => {
      server.use(
        http.get('http://localhost:3000/api/instance/settings/public', () =>
          HttpResponse.json({
            name: 'Old',
            registrationMode: 'OPEN',
            maxFileSizeBytes: 1,
            passwordResetEnabled: false,
          }),
        ),
      );
      renderDesktop(new Promise(() => {}));

      await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /sign in with browser/i })).not.toBeInTheDocument();
    });

    it('opens the browser with a PKCE challenge, redeems the code with its verifier and signs in', async () => {
      let tokenBody: { code: string; codeVerifier: string } | undefined;
      server.use(
        http.post('http://localhost:3000/api/auth/desktop/token', async ({ request }) => {
          tokenBody = (await request.json()) as typeof tokenBody;
          return HttpResponse.json({ accessToken: 'desktop-access', refreshToken: 'desktop-refresh' });
        }),
      );
      let handBack!: (result: BrowserLoginResult) => void;
      const { api, user } = renderDesktop(new Promise((resolve) => { handBack = resolve; }));

      await user.click(await screen.findByRole('button', { name: /sign in with browser/i }));

      expect(await screen.findByText(/waiting for your browser/i)).toBeInTheDocument();
      const request = api.startBrowserLogin.mock.calls[0][0];
      expect(request.instanceUrl).toBe('https://chat.example.com');

      handBack({ status: 'code', code: CODE });

      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
      expect(tokenBody?.code).toBe(CODE);
      // The verifier never went to main, and matches the challenge that did
      expect(await pkceChallenge(tokenBody!.codeVerifier)).toBe(request.codeChallenge);
      expect(getAccessToken()).toBe('desktop-access');
      expect(api.storeRefreshToken).toHaveBeenCalledWith('desktop-refresh');
    });

    it('can be cancelled while waiting', async () => {
      const { api, user } = renderDesktop(new Promise(() => {}));

      await user.click(await screen.findByRole('button', { name: /sign in with browser/i }));
      await user.click(await screen.findByRole('button', { name: /^cancel$/i }));

      expect(api.cancelBrowserLogin).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /sign in with browser/i })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each([
      [{ status: 'timeout' } as const, /didn't finish signing in in time/i],
      [{ status: 'denied' } as const, /cancelled in the browser/i],
      [{ status: 'error', message: 'boom' } as const, /couldn't sign in through the browser/i],
    ])('explains a %o', async (result, message) => {
      const { user } = renderDesktop(Promise.resolve(result));

      await user.click(await screen.findByRole('button', { name: /sign in with browser/i }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('explains a code the server refuses', async () => {
      server.use(
        http.post('http://localhost:3000/api/auth/desktop/token', () =>
          HttpResponse.json({ message: 'Invalid or expired sign-in code' }, { status: 401 }),
        ),
      );
      const { user } = renderDesktop(Promise.resolve({ status: 'code', code: CODE }));

      await user.click(await screen.findByRole('button', { name: /sign in with browser/i }));

      expect(await screen.findByText(/couldn't sign in through the browser/i)).toBeInTheDocument();
      expect(getAccessToken()).toBeNull();
    });

    it('starts by itself when the connection wizard asked for it', async () => {
      requestBrowserLoginOnLoad();
      const { api } = renderDesktop(new Promise(() => {}));

      await waitFor(() => expect(api.startBrowserLogin).toHaveBeenCalledTimes(1));
      expect(await screen.findByText(/waiting for your browser/i)).toBeInTheDocument();
    });
  });

  it('returns to the desktop sign-in page after login, and nowhere else', async () => {
    const { user } = renderWithProviders(<LoginPage />, {
      routerProps: {
        initialEntries: [{ pathname: '/login', state: { returnTo: '/desktop-login?challenge=x' } }],
      },
    });
    await user.type(screen.getByLabelText(/username/i), 'testuser');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /login/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/desktop-login?challenge=x'));
  });

  it('ignores any other return path', async () => {
    const { user } = renderWithProviders(<LoginPage />, {
      routerProps: {
        initialEntries: [{ pathname: '/login', state: { returnTo: 'https://evil.example' } }],
      },
    });
    await user.type(screen.getByLabelText(/username/i), 'testuser');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /login/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
  });
});
