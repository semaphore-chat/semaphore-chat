import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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
vi.mock('../../utils/tokenService', () => ({
  clearTokens: () => mockClearTokens(),
  getElectronRefreshToken: () => mockGetElectronRefreshToken(),
}));

vi.mock('../../utils/platform', () => ({
  isElectron: () => mockIsElectronValue,
}));

let lastLogoutBody: unknown;
const mockLogoutMutationFn = vi.fn().mockImplementation(async (opts: { body?: unknown }) => {
  callOrder.push('logoutMutation');
  lastLogoutBody = opts?.body;
  return undefined;
});
vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  authControllerLogoutMutation: () => ({ mutationFn: mockLogoutMutationFn }),
}));

import { useLogout } from '../../hooks/useLogout';

function renderUseLogout() {
  const queryClient = createTestQueryClient();
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
      'clearTokens',
    ]);
    expect(lastLogoutBody).toEqual({ refreshToken: 'refresh-token-123' });
  });

  it('exposes logoutLoading reflecting the mutation pending state', () => {
    const { result } = renderUseLogout();
    expect(result.current.logoutLoading).toBe(false);
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
});
