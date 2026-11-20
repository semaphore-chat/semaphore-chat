/**
 * The new design's session state across accounts on one tab (review I5, after #807).
 *
 * User A had the new design on (this browser's copy of the setting, the ThemeProvider's value), a
 * desktop sign-in notice showing, a banner already read out and a socket that had connected. A's
 * session ends, by each path that can end one; then user B signs in on the same tab. B must get the
 * classic shell and none of A's banner state. Every path but the token-less page load reaches this
 * state through the shared teardown (endLocalSession -> clearShellSessionState); that one, and the
 * server switch in Settings (SettingsPage.serverSwitchShell.test.tsx), call it themselves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { AuthGate } from '../../components/AuthGate';
import { ThemeProvider as AppThemeProvider } from '../../contexts/ThemeContext';
import { STORAGE_KEY } from '../../theme/constants';
import { clearTokens, endRefreshCooldown, notifyAuthFailure, setAccessToken } from '../../utils/tokenService';
import { useLogout } from '../../hooks/useLogout';
import { useNewDesignEnabled } from '../../shell/useShellChoice';
import { clearDesignPreview } from '../../shell/designPreview';
import { forgetAllAnnouncements, takeFirstAnnouncement } from '../../shell/bannerMemory';
import { showDesktopSignInNotice, useDesktopSignInBanner } from '../../data/signInNotice';
import { useConnectionState, useRecordConnectionHistory } from '../../data/connection';
import { SocketContext } from '../../utils/SocketContext';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../utils/socketSingleton', () => ({ disconnectSocket: vi.fn() }));
vi.mock('../../utils/SocketProvider', () => ({
  SocketProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../contexts/AvatarCacheContext', () => ({ AvatarCacheProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../contexts/NotificationContext', () => ({ NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../contexts/VoiceProvider', () => ({ VoiceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../contexts/RoomContext', () => ({ RoomProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../contexts/SpeakingContext', () => ({ SpeakingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../contexts/ThreadPanelProvider', () => ({ ThreadPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../contexts/UserProfileProvider', () => ({ UserProfileProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/ConnectionStatusBanner', () => ({ ConnectionStatusBanner: () => null }));
vi.mock('../../components/Electron/SecureStorageWarning', () => ({ SecureStorageWarning: () => null }));
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: false, isConnecting: false },
    actions: { leaveVoiceChannel: vi.fn() },
  }),
}));

const BASE_URL = 'http://localhost:3000';
/** A banner A's session had read out already. */
const HEARD_KEY = 'banner:a-heard';

function jwtFor(sub: string): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${body}.sig`;
}

/** The signed-in screen: which shell this tab would show, and the banner state it would show. */
function SignedInScreen() {
  const { search } = useLocation();
  const newDesign = useNewDesignEnabled(search);
  const notice = useDesktopSignInBanner();
  const connection = useConnectionState();
  const { handleLogout } = useLogout();
  return (
    <div data-testid="home">
      <span data-testid="shell">{newDesign ? 'new' : 'classic'}</span>
      <span data-testid="notice">{notice ? 'shown' : 'none'}</span>
      <span data-testid="connection">{connection}</span>
      <button type="button" onClick={() => void handleLogout()}>
        Sign out
      </button>
    </div>
  );
}

/** The login page: B "signs in" (the test's token is B's), then goes home. */
function LoginScreen() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid="login"
      onClick={() => {
        setAccessToken(jwtFor('user-b'));
        navigate('/');
      }}
    >
      Sign in
    </button>
  );
}

/** A's socket had connected this session (AppShell records it). */
function RecordConnected() {
  useRecordConnectionHistory();
  return null;
}

/** A's state in this browser before the session ends. */
function arrangeUserAState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'dark', newDesign: true }));
  act(() => showDesktopSignInNotice());
  expect(takeFirstAnnouncement(HEARD_KEY)).toBe(true);
  const recorder = render(
    <SocketContext.Provider value={{ socket: null, isConnected: true }}>
      <RecordConnected />
    </SocketContext.Provider>,
  );
  recorder.unmount();
}

function renderTab() {
  return renderWithProviders(
    <AppThemeProvider>
      <Routes>
        <Route element={<AuthGate />}>
          <Route path="/" element={<SignedInScreen />} />
        </Route>
        <Route path="/login" element={<LoginScreen />} />
      </Routes>
    </AppThemeProvider>,
    { routerProps: { initialEntries: ['/'] } },
  );
}

/** B signs in on the same tab: classic shell, no notice, a fresh connection, no banner heard. */
async function expectUserBStartsClean() {
  await act(async () => {
    screen.getByTestId('login').click();
  });
  await screen.findByTestId('home');
  expect(screen.getByTestId('shell')).toHaveTextContent('classic');
  expect(screen.getByTestId('notice')).toHaveTextContent('none');
  expect(screen.getByTestId('connection')).toHaveTextContent('connecting');
  expect(takeFirstAnnouncement(HEARD_KEY)).toBe(true);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({ newDesign: false });
}

/** A is signed in with the new design and its banner state on screen. */
async function signInUserA() {
  setAccessToken(jwtFor('user-a'));
  arrangeUserAState();
  const result = renderTab();
  await screen.findByTestId('home');
  expect(screen.getByTestId('shell')).toHaveTextContent('new');
  expect(screen.getByTestId('notice')).toHaveTextContent('shown');
  expect(screen.getByTestId('connection')).toHaveTextContent('reconnecting');
  return result;
}

let profile: 'ok' | 'unauthorized' = 'ok';
let refresh: 'refused' | 'failing' = 'refused';

describe('user A had the new design on; the session ends; user B signs in on the same tab', () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    sessionStorage.clear();
    clearDesignPreview();
    forgetAllAnnouncements();
    endRefreshCooldown();
    profile = 'ok';
    refresh = 'refused';
    server.use(
      http.get(`${BASE_URL}/api/onboarding/status`, () => HttpResponse.json({ needsSetup: false })),
      http.get(`${BASE_URL}/api/users/profile`, () =>
        profile === 'ok'
          ? HttpResponse.json({ id: 'user-b', username: 'user-b' })
          : HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
      http.post(`${BASE_URL}/api/auth/refresh`, () =>
        refresh === 'refused'
          ? HttpResponse.json({ message: 'Invalid' }, { status: 401 })
          : HttpResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
      http.post(`${BASE_URL}/api/auth/logout`, () => HttpResponse.json({}, { status: 201 })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a manual sign-out (useLogout)', async () => {
    const { user } = await signInUserA();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByTestId('login');
    await expectUserBStartsClean();
  });

  it('the server ends the session (onAuthFailure)', async () => {
    await signInUserA();
    act(() => {
      notifyAuthFailure();
    });
    await screen.findByTestId('login');
    await expectUserBStartsClean();
  });

  it('a page load whose token the server rejects, then a refused refresh', async () => {
    setAccessToken(jwtFor('user-a'));
    arrangeUserAState();
    profile = 'unauthorized';
    renderTab();
    await screen.findByTestId('login');
    profile = 'ok';
    await expectUserBStartsClean();
  });

  it('a page load with no token whose refresh is refused', async () => {
    arrangeUserAState();
    renderTab();
    await screen.findByTestId('login');
    await expectUserBStartsClean();
  });

  it('"Sign in again" after the server could not be reached', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    refresh = 'failing';
    arrangeUserAState();
    renderTab();
    for (let i = 0; i < 40 && !screen.queryByRole('button', { name: 'Sign in again' }); i++) {
      await act(() => vi.advanceTimersByTimeAsync(2_000));
    }
    await act(async () => {
      screen.getByRole('button', { name: 'Sign in again' }).click();
    });
    await screen.findByTestId('login');
    await expectUserBStartsClean();
  }, 20_000);
});
