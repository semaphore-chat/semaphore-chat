import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { VoiceSessionType } from '../../contexts/VoiceContext';

// Voice state the hook reads through stateRef
const voiceState = {
  isConnected: false,
  isConnecting: false,
  contextType: null as VoiceSessionType | null,
  currentChannelId: null as string | null,
};
const mockDispatch = vi.fn();

vi.mock('../../contexts/VoiceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/VoiceContext')>();
  return {
    ...actual,
    useVoice: () => voiceState,
    useVoiceDispatch: () => ({ dispatch: mockDispatch, stateRef: { current: voiceState } }),
  };
});

const mockRoom = { state: 'disconnected' };
vi.mock('../../hooks/useRoom', () => ({
  useRoom: () => ({ room: mockRoom, setRoom: vi.fn(), getRoom: () => mockRoom }),
}));

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1', username: 'alice', displayName: 'Alice' } }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: () => ({ data: { url: 'ws://livekit:7880' } }) };
});

vi.mock('../../hooks/useTrackSubscription', () => ({
  useTrackSubscriptionActions: () => null,
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Real join-slot logic (beginJoin/endJoin); the network-facing actions are mocked.
vi.mock('../../features/voice/voiceActions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/voice/voiceActions')>();
  return {
    ...actual,
    joinVoiceChannel: vi.fn().mockResolvedValue(undefined),
    joinDmVoice: vi.fn().mockResolvedValue(undefined),
    leaveVoiceChannel: vi.fn().mockResolvedValue(undefined),
    leaveDmVoice: vi.fn().mockResolvedValue(undefined),
    discardRoomForRejoin: vi.fn().mockResolvedValue(undefined),
  };
});

import { useVoiceConnection } from '../../hooks/useVoiceConnection';
import {
  joinVoiceChannel,
  leaveVoiceChannel,
  discardRoomForRejoin,
  getPendingJoin,
} from '../../features/voice/voiceActions';

const join = (
  actions: ReturnType<typeof useVoiceConnection>['actions'],
  options?: { quiet?: boolean; startMuted?: boolean },
) => actions.joinVoiceChannel('ch-2', 'Lounge', 'c1', false, '2026-01-01', options);

describe('useVoiceConnection join', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(voiceState, {
      isConnected: true,
      isConnecting: false,
      contextType: VoiceSessionType.Channel,
      currentChannelId: 'ch-1',
    });
  });

  it('a double-click starts one join, even while the previous call is being left', async () => {
    let finishLeave: () => void = () => {};
    vi.mocked(leaveVoiceChannel).mockReturnValueOnce(new Promise<void>((resolve) => { finishLeave = resolve; }));
    const { result } = renderHook(() => useVoiceConnection());

    let first: Promise<void> | undefined;
    await act(async () => {
      first = join(result.current.actions);
      // Second click while the first is still leaving ch-1
      await join(result.current.actions);
    });
    expect(leaveVoiceChannel).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishLeave();
      await first;
    });
    expect(joinVoiceChannel).toHaveBeenCalledTimes(1);
    expect(getPendingJoin()).toBeNull();
  });

  it('leaves the previous call without cancelling its own join', async () => {
    const { result } = renderHook(() => useVoiceConnection());
    await act(() => join(result.current.actions));

    expect(leaveVoiceChannel).toHaveBeenCalledWith(expect.anything(), { keepPendingJoin: true });
    expect(vi.mocked(joinVoiceChannel).mock.calls[0][0]).toMatchObject({
      channelId: 'ch-2',
      claimedJoin: expect.objectContaining({ kind: 'user', channelId: 'ch-2' }),
    });
  });

  it('a quiet rejoin drops the dead room instead of hanging up', async () => {
    const { result } = renderHook(() => useVoiceConnection());
    await act(() => join(result.current.actions, { quiet: true, startMuted: true }));

    expect(discardRoomForRejoin).toHaveBeenCalled();
    expect(leaveVoiceChannel).not.toHaveBeenCalled();
    expect(vi.mocked(joinVoiceChannel).mock.calls[0][0]).toMatchObject({
      quiet: true,
      startMuted: true,
      claimedJoin: expect.objectContaining({ kind: 'rejoin' }),
    });
  });
});
