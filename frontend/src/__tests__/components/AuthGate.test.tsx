import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { AuthGate } from '../../components/AuthGate';
import { notifyAuthFailure, setAccessToken, getAccessToken, clearTokens } from '../../utils/tokenService';
import { Route, Routes } from 'react-router-dom';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// Mock disconnectSocket so we can verify it's called on auth failure
const mockDisconnectSocket = vi.fn();
vi.mock('../../utils/socketSingleton', () => ({
  disconnectSocket: (...args: unknown[]) => mockDisconnectSocket(...args),
}));

// Track whether SocketProvider mounted — this is the key invariant
// (no socket connection should happen without validated auth)
let socketProviderMounted = false;

vi.mock('../../utils/SocketProvider', () => ({
  SocketProvider: ({ children }: { children: React.ReactNode }) => {
    socketProviderMounted = true;
    return <div data-testid="socket-provider">{children}</div>;
  },
}));

// Mock remaining providers to simplify tests
vi.mock('../../contexts/AvatarCacheContext', () => ({
  AvatarCacheProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../contexts/VoiceContext', () => ({
  VoiceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../contexts/RoomContext', () => ({
  RoomProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../contexts/ThreadPanelContext', () => ({
  ThreadPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../contexts/UserProfileContext', () => ({
  UserProfileProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../components/ConnectionStatusBanner', () => ({
  ConnectionStatusBanner: () => null,
}));

const BASE_URL = 'http://localhost:3000';

/** Helper: create a fake JWT with a given exp */
function makeJwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ exp, sub: 'user1' }));
  return `${header}.${body}.fakesig`;
}

function validToken() {
  return makeJwt(Math.floor(Date.now() / 1000) + 3600);
}

function expiredToken() {
  return makeJwt(Math.floor(Date.now() / 1000) - 60);
}

/** Standard: onboarding check passes, no setup needed */
function mockOnboardingOk() {
  server.use(
    http.get(`${BASE_URL}/api/onboarding/status`, () =>
      HttpResponse.json({ needsSetup: false }),
    ),
  );
}

/** Mock profile endpoint to return 401 (token rejected by server) */
function mockProfileUnauthorized() {
  server.use(
    http.get(`${BASE_URL}/api/users/profile`, () =>
      HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
    ),
  );
}

function renderAuthGate(initialRoute = '/') {
  return renderWithProviders(
    <Routes>
      <Route element={<AuthGate />}>
        <Route path="/" element={<div data-testid="home">Home</div>} />
        <Route path="/community/:communityId/channel/:channelId" element={<div data-testid="channel">Channel Page</div>} />
        <Route path="/settings" element={<div data-testid="settings">Settings</div>} />
      </Route>
      <Route path="/login" element={<div data-testid="login">Login Page</div>} />
      <Route path="/onboarding" element={<div data-testid="onboarding">Onboarding Page</div>} />
    </Routes>,
    { routerProps: { initialEntries: [initialRoute] } },
  );
}

describe('AuthGate', () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    vi.clearAllMocks();
    socketProviderMounted = false;
    mockDisconnectSocket.mockReset();
  });

  // ─── Loading State ─────────────────────────────────────────────

  describe('loading state', () => {
    it('shows loading spinner with "Connecting..." text while onboarding check is in flight', () => {
      server.use(
        http.get(`${BASE_URL}/api/onboarding/status`, () => new Promise(() => {})),
      );

      renderAuthGate();

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.getByText('Connecting...')).toBeInTheDocument();
    });

    it('does not render authenticated content while loading', () => {
      server.use(
        http.get(`${BASE_URL}/api/onboarding/status`, () => new Promise(() => {})),
      );

      setAccessToken(validToken());
      renderAuthGate();

      expect(screen.queryByTestId('home')).not.toBeInTheDocument();
    });

    it('does not mount SocketProvider while loading', () => {
      server.use(
        http.get(`${BASE_URL}/api/onboarding/status`, () => new Promise(() => {})),
      );

      setAccessToken(validToken());
      renderAuthGate();

      expect(socketProviderMounted).toBe(false);
    });
  });

  // ─── Onboarding ────────────────────────────────────────────────

  describe('onboarding redirect', () => {
    it('redirects to /onboarding when setup is needed', async () => {
      server.use(
        http.get(`${BASE_URL}/api/onboarding/status`, () =>
          HttpResponse.json({ needsSetup: true }),
        ),
      );

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('onboarding')).toBeInTheDocument();
      });
    });

    it('redirects to /onboarding even if a valid token exists', async () => {
      setAccessToken(validToken());

      server.use(
        http.get(`${BASE_URL}/api/onboarding/status`, () =>
          HttpResponse.json({ needsSetup: true }),
        ),
      );

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('onboarding')).toBeInTheDocument();
      });
    });

    it('does not mount SocketProvider when redirecting to onboarding', async () => {
      server.use(
        http.get(`${BASE_URL}/api/onboarding/status`, () =>
          HttpResponse.json({ needsSetup: true }),
        ),
      );

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('onboarding')).toBeInTheDocument();
      });
      expect(socketProviderMounted).toBe(false);
    });

    it('falls through to token check when onboarding API returns a network error', async () => {
      server.use(
        http.get(`${BASE_URL}/api/onboarding/status`, () => HttpResponse.error()),
      );

      // No token → should end up at login, not stuck loading
      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('login')).toBeInTheDocument();
      });
    });

    it('falls through to authenticated state when onboarding API returns 500 but token is valid', async () => {
      setAccessToken(validToken());

      server.use(
        http.get(`${BASE_URL}/api/onboarding/status`, () =>
          HttpResponse.json({ error: 'Internal Server Error' }, { status: 500 }),
        ),
      );

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('home')).toBeInTheDocument();
      });
    });
  });

  // ─── Unauthenticated ──────────────────────────────────────────

  describe('unauthenticated redirect', () => {
    it('redirects to /login when no token is present', async () => {
      mockOnboardingOk();
      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('login')).toBeInTheDocument();
      });
    });

    it('does not mount SocketProvider when redirecting to login', async () => {
      mockOnboardingOk();
      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('login')).toBeInTheDocument();
      });
      expect(socketProviderMounted).toBe(false);
    });

    it('redirects deep routes (e.g. /community/.../channel/...) to /login when no token', async () => {
      mockOnboardingOk();
      renderAuthGate('/community/abc/channel/xyz');

      await waitFor(() => {
        expect(screen.getByTestId('login')).toBeInTheDocument();
      });
    });

    it('redirects /settings to /login when no token', async () => {
      mockOnboardingOk();
      renderAuthGate('/settings');

      await waitFor(() => {
        expect(screen.getByTestId('login')).toBeInTheDocument();
      });
    });
  });

  // ─── Valid Token ───────────────────────────────────────────────

  describe('valid token', () => {
    it('renders authenticated content when server accepts token', async () => {
      setAccessToken(validToken());
      mockOnboardingOk();

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('home')).toBeInTheDocument();
      });
    });

    it('mounts SocketProvider when authenticated', async () => {
      setAccessToken(validToken());
      mockOnboardingOk();

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('home')).toBeInTheDocument();
      });
      expect(socketProviderMounted).toBe(true);
      expect(screen.getByTestId('socket-provider')).toBeInTheDocument();
    });

    it('gates nested child routes — /community/:id/channel/:id', async () => {
      setAccessToken(validToken());
      mockOnboardingOk();

      renderAuthGate('/community/abc/channel/xyz');

      await waitFor(() => {
        expect(screen.getByTestId('channel')).toBeInTheDocument();
      });
    });

    it('gates /settings route', async () => {
      setAccessToken(validToken());
      mockOnboardingOk();

      renderAuthGate('/settings');

      await waitFor(() => {
        expect(screen.getByTestId('settings')).toBeInTheDocument();
      });
    });

    it('does not trigger token refresh when server accepts the token', async () => {
      setAccessToken(validToken());
      mockOnboardingOk();

      let refreshCalled = false;
      server.use(
        http.post(`${BASE_URL}/api/auth/refresh`, () => {
          refreshCalled = true;
          return HttpResponse.json({ accessToken: validToken() });
        }),
      );

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('home')).toBeInTheDocument();
      });
      expect(refreshCalled).toBe(false);
    });
  });

  // ─── Server-Rejected Token + Refresh ───────────────────────────

  describe('server-rejected token refresh flow', () => {
    it('refreshes when server rejects token and authenticates on success', async () => {
      setAccessToken(expiredToken());

      const freshToken = validToken();
      mockOnboardingOk();
      mockProfileUnauthorized();
      server.use(
        http.post(`${BASE_URL}/api/auth/refresh`, () =>
          HttpResponse.json({ accessToken: freshToken }),
        ),
      );

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('home')).toBeInTheDocument();
      });
      expect(getAccessToken()).toBe(freshToken);
    });

    it('redirects to /login when refresh returns 401', async () => {
      setAccessToken(expiredToken());

      mockOnboardingOk();
      mockProfileUnauthorized();
      server.use(
        http.post(`${BASE_URL}/api/auth/refresh`, () =>
          HttpResponse.json({ message: 'Invalid' }, { status: 401 }),
        ),
      );

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('login')).toBeInTheDocument();
      });
    });

    it('clears both access and refresh tokens on failed refresh', async () => {
      setAccessToken(expiredToken());
      localStorage.setItem('refreshToken', 'old-refresh-token');

      mockOnboardingOk();
      mockProfileUnauthorized();
      server.use(
        http.post(`${BASE_URL}/api/auth/refresh`, () =>
          HttpResponse.json({ message: 'Expired' }, { status: 401 }),
        ),
      );

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('login')).toBeInTheDocument();
      });
      expect(getAccessToken()).toBeNull();
      expect(localStorage.getItem('refreshToken')).toBeNull();
    });

    it('calls disconnectSocket when refresh fails', async () => {
      setAccessToken(expiredToken());

      mockOnboardingOk();
      mockProfileUnauthorized();
      server.use(
        http.post(`${BASE_URL}/api/auth/refresh`, () =>
          HttpResponse.json({ message: 'Expired' }, { status: 401 }),
        ),
      );

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('login')).toBeInTheDocument();
      });
      expect(mockDisconnectSocket).toHaveBeenCalled();
    });

    it('redirects to /login when refresh returns a network error', async () => {
      setAccessToken(expiredToken());

      mockOnboardingOk();
      mockProfileUnauthorized();
      server.use(
        http.post(`${BASE_URL}/api/auth/refresh`, () => HttpResponse.error()),
      );

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('login')).toBeInTheDocument();
      });
      expect(getAccessToken()).toBeNull();
    });

    it('does not mount SocketProvider during refresh attempt', async () => {
      setAccessToken(expiredToken());

      // Use a delayed response so we can assert during the in-flight state
      let refreshStarted = false;
      mockOnboardingOk();
      mockProfileUnauthorized();
      server.use(
        http.post(`${BASE_URL}/api/auth/refresh`, async () => {
          refreshStarted = true;
          await new Promise((r) => setTimeout(r, 200));
          return HttpResponse.json({ accessToken: validToken() });
        }),
      );

      renderAuthGate();

      // Wait for refresh to start, then check loading state
      await waitFor(() => {
        expect(refreshStarted).toBe(true);
      });
      // During refresh, SocketProvider should not be mounted
      expect(socketProviderMounted).toBe(false);
      expect(screen.getByText('Connecting...')).toBeInTheDocument();

      // After refresh completes, should be authenticated
      await waitFor(() => {
        expect(screen.getByTestId('home')).toBeInTheDocument();
      });
      expect(socketProviderMounted).toBe(true);
    });

    it('does not mount SocketProvider when refresh fails', async () => {
      setAccessToken(expiredToken());

      mockOnboardingOk();
      mockProfileUnauthorized();
      server.use(
        http.post(`${BASE_URL}/api/auth/refresh`, () =>
          HttpResponse.json({ message: 'Expired' }, { status: 401 }),
        ),
      );

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('login')).toBeInTheDocument();
      });
      expect(socketProviderMounted).toBe(false);
    });
  });

  // ─── Mid-Session Auth Failure (event-driven) ──────────────────

  describe('mid-session auth failure via notifyAuthFailure', () => {
    it('redirects to /login when notifyAuthFailure is called', async () => {
      setAccessToken(validToken());
      mockOnboardingOk();

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('home')).toBeInTheDocument();
      });

      // Simulate the interceptor detecting an unrecoverable 401
      act(() => {
        notifyAuthFailure();
      });

      await waitFor(() => {
        expect(screen.getByTestId('login')).toBeInTheDocument();
      });
    });

    it('calls disconnectSocket and clears tokens on notifyAuthFailure', async () => {
      setAccessToken(validToken());
      mockOnboardingOk();

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('home')).toBeInTheDocument();
      });

      act(() => {
        notifyAuthFailure();
      });

      await waitFor(() => {
        expect(screen.getByTestId('login')).toBeInTheDocument();
      });
      expect(mockDisconnectSocket).toHaveBeenCalled();
      expect(getAccessToken()).toBeNull();
    });

    it('unmounts SocketProvider on notifyAuthFailure', async () => {
      setAccessToken(validToken());
      mockOnboardingOk();

      renderAuthGate();

      await waitFor(() => {
        expect(screen.getByTestId('socket-provider')).toBeInTheDocument();
      });

      act(() => {
        notifyAuthFailure();
      });

      await waitFor(() => {
        expect(screen.queryByTestId('socket-provider')).not.toBeInTheDocument();
      });
    });
  });
});
