import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { VoiceActionType, VoiceEndReason, VoiceFailureKind, type VoiceJoinTarget } from '../../contexts/VoiceContext';

const mockDispatch = vi.fn();
const mockJoinVoiceChannel = vi.fn().mockResolvedValue(undefined);
const mockJoinDmVoice = vi.fn().mockResolvedValue(undefined);
let voiceState: Record<string, unknown> = {};

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: voiceState,
    actions: { joinVoiceChannel: mockJoinVoiceChannel, joinDmVoice: mockJoinDmVoice },
  }),
}));
vi.mock('../../contexts/VoiceContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../contexts/VoiceContext')>()),
  useVoiceDispatch: () => ({ dispatch: mockDispatch, stateRef: { current: null } }),
}));
vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useVoiceNotice } from '../../data/voiceNotice';
import { VOICE_FAILURE_COPY } from '../../features/voice/joinFailure';
import { logger } from '../../utils/logger';

const channel: VoiceJoinTarget = {
  type: 'channel',
  channelId: 'vc-1',
  channelName: 'Squad Up',
  communityId: 'c-1',
  isPrivate: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const dm: VoiceJoinTarget = { type: 'dm', dmGroupId: 'dm-1', dmGroupName: 'Aiko' };
const base = { isConnected: false, isConnecting: false, joinFailure: null, lastEnded: null };

beforeEach(() => {
  vi.clearAllMocks();
  voiceState = { ...base };
});

describe('useVoiceNotice', () => {
  it('is null with nothing to say', () => {
    expect(renderHook(() => useVoiceNotice()).result.current).toBeNull();
  });

  it('a failed join: its copy, and Retry joins the same room again', async () => {
    voiceState = { ...base, joinFailure: { kind: VoiceFailureKind.ServerUnreachable, at: 5, target: channel } };
    const { result } = renderHook(() => useVoiceNotice());
    const notice = result.current!;
    expect(notice.severity).toBe('error');
    expect(notice.title).toBe(VOICE_FAILURE_COPY[VoiceFailureKind.ServerUnreachable].title);
    expect(notice.retryTarget).toEqual(channel);

    await notice.retry();
    expect(mockJoinVoiceChannel).toHaveBeenCalledWith('vc-1', 'Squad Up', 'c-1', false, channel.createdAt);
  });

  it('Retry never moves someone who has since gone into another call (the state when pressed counts)', async () => {
    voiceState = { ...base, joinFailure: { kind: VoiceFailureKind.ServerUnreachable, at: 5, target: channel } };
    const { result, rerender } = renderHook(() => useVoiceNotice());
    const notice = result.current!;
    // Meanwhile the user joined another room (a join elsewhere started, then connected).
    voiceState = { ...voiceState, isConnecting: true, currentChannelId: 'vc-other' };
    rerender();
    await notice.retry();
    voiceState = { ...voiceState, isConnecting: false, isConnected: true };
    rerender();
    await notice.retry();
    expect(mockJoinVoiceChannel).not.toHaveBeenCalled();
    // A join to the same room that is still running is not "elsewhere": Retry is allowed (the join path dedupes).
    voiceState = { ...base, isConnecting: true, currentChannelId: 'vc-1', joinFailure: voiceState.joinFailure };
    rerender();
    await notice.retry();
    expect(mockJoinVoiceChannel).toHaveBeenCalledTimes(1);
  });

  it('Retry of a DM call joins the DM', async () => {
    voiceState = { ...base, lastEnded: { reason: VoiceEndReason.ReconnectFailed, at: 9, target: dm } };
    const { result } = renderHook(() => useVoiceNotice());
    await result.current!.retry();
    expect(mockJoinDmVoice).toHaveBeenCalledWith('dm-1', 'Aiko');
  });

  it('a Retry that fails again is logged, not thrown (the next notice explains it)', async () => {
    mockJoinVoiceChannel.mockRejectedValueOnce(new Error('still down'));
    voiceState = { ...base, joinFailure: { kind: VoiceFailureKind.ServerUnreachable, at: 5, target: channel } };
    const { result } = renderHook(() => useVoiceNotice());
    await expect(result.current!.retry()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('no Retry where trying again cannot help; Retry is then a no-op', async () => {
    voiceState = { ...base, lastEnded: { reason: VoiceEndReason.ParticipantRemoved, at: 9, target: channel } };
    const { result } = renderHook(() => useVoiceNotice());
    expect(result.current!.retryTarget).toBeNull();
    await result.current!.retry();
    expect(mockJoinVoiceChannel).not.toHaveBeenCalled();
  });

  it('Dismiss clears the notice', () => {
    voiceState = { ...base, lastEnded: { reason: VoiceEndReason.RoomDeleted, at: 9 } };
    renderHook(() => useVoiceNotice()).result.current!.dismiss();
    expect(mockDispatch).toHaveBeenCalledWith({ type: VoiceActionType.ClearVoiceNotice });
  });

  it('says a join is running, so Retry can be disabled', () => {
    voiceState = { ...base, isConnecting: true, joinFailure: { kind: VoiceFailureKind.ServerUnreachable, at: 5, target: channel } };
    expect(renderHook(() => useVoiceNotice()).result.current!.joining).toBe(true);
  });
});
