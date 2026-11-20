import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders, createTestQueryClient } from '../test-utils';
import { MobileProfilePanel } from '../../components/Mobile/Panels/MobileProfilePanel';
import { MobileNavigationProvider } from '../../components/Mobile/Navigation/MobileNavigationContext';
import { setAccessToken, getAccessToken } from '../../utils/tokenService';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../hooks/useAuthenticatedImage', () => ({
  useAuthenticatedImage: () => ({ blobUrl: null, isLoading: false, error: null }),
}));
vi.mock('../../components/Profile/ClipLibrary', () => ({ ClipLibrary: () => null }));

const mockLeaveVoiceChannel = vi.fn().mockResolvedValue(undefined);
let mockIsConnected = false;
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: { isConnected: mockIsConnected },
    actions: { leaveVoiceChannel: mockLeaveVoiceChannel },
  }),
}));

const mockDisconnectSocket = vi.fn();
vi.mock('../../utils/socketSingleton', () => ({
  disconnectSocket: () => mockDisconnectSocket(),
}));

const mockClearSavedConnection = vi.fn();
vi.mock('../../features/voice/voiceActions', () => ({
  clearSavedConnection: () => mockClearSavedConnection(),
}));

function renderPanel(queryClient = createTestQueryClient()) {
  return {
    ...renderWithProviders(
      <Routes>
        <Route path="/login" element={<div data-testid="login">Login Page</div>} />
        <Route
          path="*"
          element={
            <MobileNavigationProvider>
              <MobileProfilePanel />
            </MobileNavigationProvider>
          }
        />
      </Routes>,
      { queryClient, routerProps: { initialEntries: ['/'] } },
    ),
  };
}

async function clickLogout(user: ReturnType<typeof renderPanel>['user']) {
  await user.click(await screen.findByText('Logout'));
}

describe('MobileProfilePanel sign-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected = false;
    setAccessToken('access-token');
    sessionStorage.setItem('semaphore:composerDraft:channel:c1', 'secret draft');
    sessionStorage.setItem('semaphore-design-preview', 'lounge');
    server.use(
      http.post('http://localhost:3000/api/auth/logout', () => new HttpResponse(null, { status: 200 })),
    );
  });

  it('clears tokens, drafts, preview and the cache, disconnects the socket and goes to /login', async () => {
    const { user, queryClient } = renderPanel();
    await screen.findByText('Logout');
    queryClient.setQueryData(['communities'], [{ id: 'c1' }]);

    await clickLogout(user);

    expect(await screen.findByTestId('login')).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
    expect(mockDisconnectSocket).toHaveBeenCalled();
    expect(mockClearSavedConnection).toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
    expect(sessionStorage.getItem('semaphore:composerDraft:channel:c1')).toBeNull();
    expect(sessionStorage.getItem('semaphore-design-preview')).toBeNull();
  });

  it('leaves the voice channel first when connected', async () => {
    mockIsConnected = true;
    const { user } = renderPanel();

    await clickLogout(user);

    await screen.findByTestId('login');
    expect(mockLeaveVoiceChannel).toHaveBeenCalled();
  });

  it('completes the local sign-out when the server call fails', async () => {
    server.use(
      http.post('http://localhost:3000/api/auth/logout', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    const { user, queryClient } = renderPanel();
    await screen.findByText('Logout');
    queryClient.setQueryData(['communities'], [{ id: 'c1' }]);

    await clickLogout(user);

    await waitFor(() => expect(screen.getByTestId('login')).toBeInTheDocument());
    expect(getAccessToken()).toBeNull();
    expect(mockDisconnectSocket).toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });

  it('is disabled and busy while the logout call runs; another tap does nothing', async () => {
    let requests = 0;
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    server.use(
      http.post('http://localhost:3000/api/auth/logout', async () => {
        requests++;
        await answered;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const { user } = renderPanel();

    await clickLogout(user);

    const row = (await screen.findByText('Logging out…')).closest('[role="button"]') as HTMLElement;
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveAttribute('aria-busy', 'true');
    // A tap can't reach it (pointer-events: none); even an activation that does is a no-op
    fireEvent.click(row);
    await waitFor(() => expect(requests).toBe(1));
    expect(screen.queryByTestId('login')).not.toBeInTheDocument();

    answer();
    expect(await screen.findByTestId('login')).toBeInTheDocument();
    expect(requests).toBe(1);
  });
});
