import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useServerMuteEffect } from '../../hooks/useServerMuteEffect';

const mockDispatch = vi.fn();
let mockRoom: { localParticipant: { setMicrophoneEnabled: ReturnType<typeof vi.fn> } } | null = null;
let mockUser: { id: string } | null = null;

// Capture the callback passed to useServerEvent
let serverEventCallback: ((payload: unknown) => void) | null = null;

vi.mock('@kraken/shared', () => ({
  ServerEvents: {
    VOICE_CHANNEL_USER_UPDATED: 'voiceChannelUserUpdated',
  },
}));

vi.mock('../../socket-hub/useServerEvent', () => ({
  useServerEvent: vi.fn((_event: string, callback: (payload: unknown) => void) => {
    serverEventCallback = callback;
  }),
}));

vi.mock('../../contexts/VoiceContext', () => ({
  useVoiceDispatch: vi.fn(() => ({ dispatch: mockDispatch })),
}));

vi.mock('../../hooks/useRoom', () => ({
  useRoom: vi.fn(() => ({ room: mockRoom })),
}));

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(() => ({ user: mockUser })),
}));

vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../hooks/useSound', () => ({
  playSound: vi.fn(),
  Sounds: { error: 'error' },
}));

describe('useServerMuteEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverEventCallback = null;
    mockUser = { id: 'user-1' };
    mockRoom = {
      localParticipant: {
        setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  it('dispatches SET_SERVER_MUTED when local user is server-muted', () => {
    renderHook(() => useServerMuteEffect());

    expect(serverEventCallback).toBeTruthy();
    serverEventCallback!({
      channelId: 'ch-1',
      userId: 'user-1',
      user: { id: 'user-1', isServerMuted: true },
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_SERVER_MUTED',
      payload: true,
    });
  });

  it('forces mic off when server-muted', () => {
    renderHook(() => useServerMuteEffect());

    serverEventCallback!({
      channelId: 'ch-1',
      userId: 'user-1',
      user: { id: 'user-1', isServerMuted: true },
    });

    expect(mockRoom!.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
  });

  it('dispatches SET_SERVER_MUTED(false) when server-unmuted', () => {
    renderHook(() => useServerMuteEffect());

    serverEventCallback!({
      channelId: 'ch-1',
      userId: 'user-1',
      user: { id: 'user-1', isServerMuted: false },
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_SERVER_MUTED',
      payload: false,
    });
  });

  it('does not force mic on when server-unmuted', () => {
    renderHook(() => useServerMuteEffect());

    serverEventCallback!({
      channelId: 'ch-1',
      userId: 'user-1',
      user: { id: 'user-1', isServerMuted: false },
    });

    // Should NOT call setMicrophoneEnabled(true)
    expect(mockRoom!.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('ignores events for other users', () => {
    renderHook(() => useServerMuteEffect());

    serverEventCallback!({
      channelId: 'ch-1',
      userId: 'user-2',
      user: { id: 'user-2', isServerMuted: true },
    });

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockRoom!.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('does nothing when no user is logged in', () => {
    mockUser = null;
    renderHook(() => useServerMuteEffect());

    serverEventCallback!({
      channelId: 'ch-1',
      userId: 'user-1',
      user: { id: 'user-1', isServerMuted: true },
    });

    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
