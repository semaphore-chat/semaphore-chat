import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LOGOUT_REQUEST_TIMEOUT_MS } from '../../utils/serverSignOut';
import { createTestWrapper, createTestQueryClient } from '../test-utils';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const callOrder: string[] = [];

let mockIsConnected = false;
const mockLeaveVoiceChannel = vi.fn().mockImplementation(async () => {
  callOrder.push('leaveVoiceChannel');
});
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: vi.fn(() => ({
    state: { isConnected: mockIsConnected },
    actions: { leaveVoiceChannel: mockLeaveVoiceChannel },
  })),
}));

const mockClearSavedConnection = vi.fn().mockImplementation(() => {
  callOrder.push('clearSavedConnection');
});
vi.mock('../../features/voice/voiceActions', () => ({
  clearSavedConnection: () => mockClearSavedConnection(),
}));

const mockDisconnectSocket = vi.fn().mockImplementation(() => {
  callOrder.push('disconnectSocket');
});
vi.mock('../../utils/socketSingleton', () => ({
  disconnectSocket: () => mockDisconnectSocket(),
}));

let mockIsElectronValue = false;
const mockGetElectronRefreshToken = vi.fn().mockImplementation(async () => {
  callOrder.push('getElectronRefreshToken');
  return 'refresh-token-123';
});
const mockClearTokens = vi.fn().mockImplementation(() => {
  callOrder.push('clearTokens');
});
const mockMarkServerSignOutOwed = vi.fn();
vi.mock('../../utils/tokenService', () => ({
  clearTokens: () => mockClearTokens(),
  getElectronRefreshToken: () => mockGetElectronRefreshToken(),
  markServerSignOutOwed: () => mockMarkServerSignOutOwed(),
  clearServerSignOutOwed: vi.fn(),
  isServerSignOutOwed: () => false,
}));

vi.mock('../../utils/platform', () => ({
  isElectron: () => mockIsElectronValue,
}));

let lastLogoutBody: unknown;
let lastLogoutSignal: AbortSignal | undefined;
/** The logout call; resolves like the generated client (no throw on HTTP errors). */
const mockLogoutMutationFn = vi.fn().mockImplementation(async (opts: { body?: unknown; signal?: AbortSignal }) => {
  callOrder.push('logoutMutation');
  lastLogoutBody = opts?.body;
  lastLogoutSignal = opts?.signal;
  return { response: { ok: true, status: 201 } };
});
vi.mock('../../api-client/sdk.gen', () => ({
  authControllerLogout: (opts: { body?: unknown; signal?: AbortSignal }) => mockLogoutMutationFn(opts),
}));

/** A logout request the server never answers (ends only when aborted). */
function hangingLogout(opts: { signal?: AbortSignal }) {
  callOrder.push('logoutMutation');
  lastLogoutSignal = opts.signal;
  return new Promise((_resolve, reject) => {
    opts.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
}

import { useLogout } from '../../hooks/useLogout';
import { STORAGE_KEY } from '../../theme/constants';
import { showDesktopSignInNotice, useDesktopSignInBanner } from '../../data/signInNotice';

function renderUseLogout(queryClient = createTestQueryClient()) {
  return renderHook(() => useLogout(), {
    wrapper: createTestWrapper({ queryClient }),
  });
}

describe('useLogout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    mockIsConnected = false;
    mockIsElectronValue = false;
    lastLogoutBody = undefined;
    lastLogoutSignal = undefined;
    vi.useRealTimers();
  });

  it('runs the full logout sequence in order when voice is not connected', async () => {
    const { result } = renderUseLogout();

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(mockLeaveVoiceChannel).not.toHaveBeenCalled();
    expect(callOrder).toEqual([
      'clearSavedConnection',
      'disconnectSocket',
      'logoutMutation',
      'clearSavedConnection',
      'disconnectSocket',
      'clearTokens',
    ]);
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('leaves the voice channel first when connected, before the rest of the sequence', async () => {
    mockIsConnected = true;
    const { result } = renderUseLogout();

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(callOrder).toEqual([
      'leaveVoiceChannel',
      'clearSavedConnection',
      'disconnectSocket',
      'logoutMutation',
      'clearSavedConnection',
      'disconnectSocket',
      'clearTokens',
    ]);
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('does not block logout when leaving the voice channel throws', async () => {
    mockIsConnected = true;
    mockLeaveVoiceChannel.mockRejectedValueOnce(new Error('leave failed'));
    const { result } = renderUseLogout();

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(callOrder).toEqual([
      'clearSavedConnection',
      'disconnectSocket',
      'logoutMutation',
      'clearSavedConnection',
      'disconnectSocket',
      'clearTokens',
    ]);
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('still clears tokens and navigates when the logout mutation rejects', async () => {
    mockLogoutMutationFn.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderUseLogout();

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(mockClearTokens).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('electron: still clears tokens and navigates when fetching the refresh token throws', async () => {
    mockIsElectronValue = true;
    mockGetElectronRefreshToken.mockRejectedValueOnce(new Error('ipc failed'));
    const { result } = renderUseLogout();

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(mockLogoutMutationFn).not.toHaveBeenCalled();
    expect(mockClearTokens).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('web: sends no refreshToken in the logout body', async () => {
    const { result } = renderUseLogout();

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(mockGetElectronRefreshToken).not.toHaveBeenCalled();
    expect(lastLogoutBody).toEqual({ refreshToken: undefined });
  });

  it('electron: fetches and sends the refresh token in the logout body, before the mutation fires', async () => {
    mockIsElectronValue = true;
    const { result } = renderUseLogout();

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(callOrder).toEqual([
      'clearSavedConnection',
      'disconnectSocket',
      'getElectronRefreshToken',
      'logoutMutation',
      'clearSavedConnection',
      'disconnectSocket',
      'clearTokens',
    ]);
    expect(lastLogoutBody).toEqual({ refreshToken: 'refresh-token-123' });
  });

  it('exposes logoutLoading: true while a sign-out runs, false after', async () => {
    let answer!: (value: unknown) => void;
    mockLogoutMutationFn.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const { result } = renderUseLogout();
    expect(result.current.logoutLoading).toBe(false);

    let done!: Promise<void>;
    act(() => {
      done = result.current.handleLogout();
    });
    expect(result.current.logoutLoading).toBe(true);

    await act(async () => {
      answer({ response: { ok: true, status: 201 } });
      await done;
    });
    expect(result.current.logoutLoading).toBe(false);
  });

  it('a second activation while signing out does nothing (one sequence, one logout call)', async () => {
    let answer!: (value: unknown) => void;
    mockLogoutMutationFn.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const { result } = renderUseLogout();

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.handleLogout();
    });
    act(() => {
      second = result.current.handleLogout();
    });
    expect(second).toBe(first);

    await act(async () => {
      answer({ response: { ok: true, status: 201 } });
      await first;
    });
    expect(mockLogoutMutationFn).toHaveBeenCalledTimes(1);
    expect(mockClearTokens).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  describe('a logout request the server never answers', () => {
    it('is aborted after the timeout, and the local sign-out completes', async () => {
      vi.useFakeTimers();
      mockLogoutMutationFn.mockImplementationOnce(hangingLogout);
      const { result } = renderUseLogout();

      let done!: Promise<void>;
      act(() => {
        done = result.current.handleLogout();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOGOUT_REQUEST_TIMEOUT_MS - 1);
      });
      expect(mockClearTokens).not.toHaveBeenCalled();
      expect(result.current.logoutLoading).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
        await done;
      });
      expect(lastLogoutSignal?.aborted).toBe(true);
      expect(mockClearTokens).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/login');
      expect(result.current.logoutLoading).toBe(false);
    });

    it('web: remembers that the server sign-out is still owed', async () => {
      vi.useFakeTimers();
      mockLogoutMutationFn.mockImplementationOnce(hangingLogout);
      const { result } = renderUseLogout();

      await act(async () => {
        const done = result.current.handleLogout();
        await vi.advanceTimersByTimeAsync(LOGOUT_REQUEST_TIMEOUT_MS);
        await done;
      });
      expect(mockMarkServerSignOutOwed).toHaveBeenCalledTimes(1);
    });
  });

  it('web: a refused logout (HTTP error) leaves the server sign-out owed', async () => {
    mockLogoutMutationFn.mockResolvedValueOnce({ response: { ok: false, status: 500 } });
    const { result } = renderUseLogout();
    await act(async () => {
      await result.current.handleLogout();
    });
    expect(mockMarkServerSignOutOwed).toHaveBeenCalledTimes(1);
    expect(mockClearTokens).toHaveBeenCalled();
  });

  it('web: a confirmed logout owes nothing', async () => {
    const { result } = renderUseLogout();
    await act(async () => {
      await result.current.handleLogout();
    });
    expect(mockMarkServerSignOutOwed).not.toHaveBeenCalled();
  });

  it('electron: a failed logout owes nothing (the stored refresh token is deleted locally)', async () => {
    mockIsElectronValue = true;
    mockLogoutMutationFn.mockResolvedValueOnce({ response: { ok: false, status: 500 } });
    const { result } = renderUseLogout();
    await act(async () => {
      await result.current.handleLogout();
    });
    expect(mockMarkServerSignOutOwed).not.toHaveBeenCalled();
    expect(mockClearTokens).toHaveBeenCalled();
  });

  it('clears saved composer drafts so the next user on this tab does not see them', async () => {
    sessionStorage.setItem('semaphore:composerDraft:channel:c1', 'secret draft');
    sessionStorage.setItem('unrelated', 'keep');
    const { result } = renderUseLogout();
    await act(async () => {
      await result.current.handleLogout();
    });
    expect(sessionStorage.getItem('semaphore:composerDraft:channel:c1')).toBeNull();
    expect(sessionStorage.getItem('unrelated')).toBe('keep');
  });

  it("clears this tab's design preview so the next user on this tab does not inherit it", async () => {
    sessionStorage.setItem('semaphore-design-preview', 'lounge');
    const { result } = renderUseLogout();
    await act(async () => {
      await result.current.handleLogout();
    });
    expect(sessionStorage.getItem('semaphore-design-preview')).toBeNull();
  });

  it("forgets this browser's copy of the new design setting and a sign-in notice still showing (M4)", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'dark', newDesign: true }));
    showDesktopSignInNotice();
    const notice = renderHook(() => useDesktopSignInBanner());
    const queryClient = createTestQueryClient();
    const { result } = renderUseLogout(queryClient);
    queryClient.setQueryData([{ _id: 'appearanceSettingsControllerGetSettings' }], { newDesign: true });
    await act(async () => {
      await result.current.handleLogout();
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({ mode: 'dark', newDesign: false });
    expect(queryClient.getQueryData([{ _id: 'appearanceSettingsControllerGetSettings' }])).toBeUndefined();
    expect(notice.result.current).toBeNull();
  });

  it('passes login state on, e.g. the desktop sign-in page to come back to', async () => {
    const { result } = renderUseLogout();

    await act(async () => {
      await result.current.handleLogout({ returnTo: '/desktop-login?challenge=x' });
    });

    expect(mockNavigate).toHaveBeenCalledWith('/login', {
      state: { returnTo: '/desktop-login?challenge=x' },
    });
  });

  describe('query cache', () => {
    it('clears every cached query so the next account never sees the previous one\'s data', async () => {
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(['userControllerGetProfile'], { id: 'u1', username: 'alice' });
      queryClient.setQueryData(['communities'], [{ id: 'c1' }]);
      const { result } = renderUseLogout(queryClient);

      await act(async () => {
        await result.current.handleLogout();
      });

      expect(queryClient.getQueryCache().getAll()).toEqual([]);
      expect(queryClient.getQueryData(['userControllerGetProfile'])).toBeUndefined();
      expect(queryClient.getQueryData(['communities'])).toBeUndefined();
    });

    it('clears the cache even when the logout mutation rejects', async () => {
      mockLogoutMutationFn.mockRejectedValueOnce(new Error('network down'));
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(['communities'], [{ id: 'c1' }]);
      const { result } = renderUseLogout(queryClient);

      await act(async () => {
        await result.current.handleLogout();
      });

      expect(queryClient.getQueryCache().getAll()).toEqual([]);
    });

    it('clears the cache after the socket is disconnected and tokens are cleared, before navigating', async () => {
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(['communities'], [{ id: 'c1' }]);
      const clear = queryClient.clear.bind(queryClient);
      vi.spyOn(queryClient, 'clear').mockImplementation(() => {
        callOrder.push('clearQueryCache');
        clear();
      });
      mockNavigate.mockImplementationOnce(() => {
        callOrder.push('navigate');
      });
      const { result } = renderUseLogout(queryClient);

      await act(async () => {
        await result.current.handleLogout();
      });

      expect(callOrder).toEqual([
        'clearSavedConnection',
        'disconnectSocket',
        'logoutMutation',
        'clearSavedConnection',
        'disconnectSocket',
        'clearTokens',
        'clearQueryCache',
        'navigate',
      ]);
    });

    it('does not let an in-flight query repopulate the cache after sign-out', async () => {
      const queryClient = createTestQueryClient();
      let resolveFetch!: (value: unknown) => void;
      const inFlight = queryClient
        .fetchQuery({
          queryKey: ['userControllerGetProfile'],
          queryFn: () => new Promise((resolve) => { resolveFetch = resolve; }),
        })
        .catch(() => undefined);
      const { result } = renderUseLogout(queryClient);

      await act(async () => {
        await result.current.handleLogout();
      });
      resolveFetch({ id: 'u1', username: 'alice' });
      await inFlight;

      expect(queryClient.getQueryData(['userControllerGetProfile'])).toBeUndefined();
      expect(queryClient.getQueryCache().getAll()).toEqual([]);
    });
  });
});
