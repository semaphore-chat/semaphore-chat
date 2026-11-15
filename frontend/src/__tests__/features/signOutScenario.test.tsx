/**
 * A's session is ended by the server (not a manual sign-out) while A is in a
 * voice channel with a half-written message; B then signs in on the same tab
 * within the voice recovery window. B must not be auto-joined into A's
 * channel, and must not see A's draft.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { AuthGate } from '../../components/AuthGate';
import { clearTokens, notifyAuthFailure, setAccessToken } from '../../utils/tokenService';
import { useVoiceRecovery } from '../../hooks/useVoiceRecovery';
import { useComposerDraft } from '../../hooks/useComposerDraft';

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

const mockJoinVoiceChannel = vi.fn().mockResolvedValue(undefined);
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: false, isConnecting: false },
    actions: { joinVoiceChannel: mockJoinVoiceChannel, joinDmVoice: vi.fn() },
  }),
}));

const BASE_URL = 'http://localhost:3000';
const DRAFT_KEY = 'channel:ch-1';

function jwtFor(sub: string): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${body}.sig`;
}

/** A signed-in screen: runs voice recovery and shows the channel's draft. */
function SignedInScreen() {
  const { isRecovering } = useVoiceRecovery();
  const [draft] = useComposerDraft(DRAFT_KEY);
  return (
    <div data-testid="home" data-recovering={String(isRecovering)}>
      draft:[{draft}]
    </div>
  );
}

/** The login page: "signs in" as whoever the test set up, then goes home. */
function LoginScreen() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="login" onClick={() => navigate('/')}>
      Sign in
    </button>
  );
}

let profileId = 'user-a';

describe('a server-ended session, then another user signs in on the same tab', () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    sessionStorage.clear();
    mockJoinVoiceChannel.mockClear();
    profileId = 'user-a';
    server.use(
      http.get(`${BASE_URL}/api/onboarding/status`, () => HttpResponse.json({ needsSetup: false })),
      http.get(`${BASE_URL}/api/users/profile`, () =>
        HttpResponse.json({ id: profileId, username: profileId }),
      ),
      http.get(`${BASE_URL}/api/livekit/connection-info`, () =>
        HttpResponse.json({ url: 'ws://livekit.test' }),
      ),
      http.post(`${BASE_URL}/api/auth/refresh`, () =>
        HttpResponse.json({ message: 'No refresh token provided' }, { status: 401 }),
      ),
    );
  });

  it('does not auto-join B into A\'s voice channel, and B does not see A\'s draft', async () => {
    setAccessToken(jwtFor('user-a'));
    const { user, queryClient } = renderWithProviders(
      <Routes>
        <Route element={<AuthGate />}>
          <Route path="/" element={<SignedInScreen />} />
        </Route>
        <Route path="/login" element={<LoginScreen />} />
      </Routes>,
      { routerProps: { initialEntries: ['/'] } },
    );
    await screen.findByTestId('home');

    // A joins a voice channel (saved for recovery) and starts typing
    localStorage.setItem(
      'semaphore_voice_connection',
      JSON.stringify({
        userId: 'user-a',
        contextType: 'channel',
        channelId: 'ch-a',
        channelName: "A's room",
        communityId: 'c1',
        isPrivate: false,
        createdAt: '2026-01-01T00:00:00Z',
        timestamp: Date.now(),
      }),
    );
    sessionStorage.setItem(`semaphore:composerDraft:${DRAFT_KEY}`, "A's unsent secret");

    // The server ends A's session (expiry, ban, signed out elsewhere)
    act(() => {
      notifyAuthFailure();
    });
    await screen.findByTestId('login');

    // B signs in on the same tab, well within the recovery window
    profileId = 'user-b';
    setAccessToken(jwtFor('user-b'));
    await user.click(screen.getByTestId('login'));

    await screen.findByTestId('home');
    // Recovery decides once B's profile and the connection info have loaded
    const loaded = (id: string) =>
      queryClient
        .getQueryCache()
        .getAll()
        .some((q) => JSON.stringify(q.queryKey).includes(id) && q.state.status === 'success');
    await waitFor(() => {
      expect(loaded('userControllerGetProfile')).toBe(true);
      expect(loaded('livekitControllerGetConnectionInfo')).toBe(true);
    });
    expect(mockJoinVoiceChannel).not.toHaveBeenCalled();
    expect(screen.getByTestId('home')).toHaveTextContent('draft:[]');
    expect(localStorage.getItem('semaphore_voice_connection')).toBeNull();
  });
});
