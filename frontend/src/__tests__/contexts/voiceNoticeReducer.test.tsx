import { describe, it, expect } from 'vitest';
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import {
  useVoice,
  useVoiceDispatch,
  VoiceActionType,
  VoiceEndReason,
  VoiceFailureKind,
} from '../../contexts/VoiceContext';
import { VoiceProvider } from '../../contexts/VoiceProvider';

const wrapper = ({ children }: { children: React.ReactNode }) => <VoiceProvider>{children}</VoiceProvider>;
const useBoth = () => ({ state: useVoice(), ...useVoiceDispatch() });

const channelPayload = {
  channelId: 'vc-1',
  channelName: 'Hangout',
  communityId: 'c1',
  isPrivate: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const target = { type: 'channel' as const, ...channelPayload };

describe('voice notice state', () => {
  it('an involuntary end records the call as the Retry target', () => {
    const { result } = renderHook(useBoth, { wrapper });
    act(() => result.current.dispatch({ type: VoiceActionType.SetConnected, payload: channelPayload }));
    act(() =>
      result.current.dispatch({
        type: VoiceActionType.SetDisconnected,
        payload: { reason: VoiceEndReason.ReconnectFailed, error: 'offline' },
      }),
    );
    expect(result.current.state.lastEnded).toMatchObject({ reason: VoiceEndReason.ReconnectFailed, error: 'offline', target });
  });

  it('a DM call is recorded as a DM target', () => {
    const { result } = renderHook(useBoth, { wrapper });
    act(() =>
      result.current.dispatch({ type: VoiceActionType.SetDmConnected, payload: { dmGroupId: 'dm-1', dmGroupName: 'Alice' } }),
    );
    act(() =>
      result.current.dispatch({ type: VoiceActionType.SetDisconnected, payload: { reason: VoiceEndReason.DuplicateIdentity } }),
    );
    expect(result.current.state.lastEnded?.target).toEqual({ type: 'dm', dmGroupId: 'dm-1', dmGroupName: 'Alice' });
  });

  it('a join failure stays until dismissed or a new join starts', () => {
    const { result } = renderHook(useBoth, { wrapper });
    const payload = { kind: VoiceFailureKind.MediaUnreachable, error: 'x', target };

    act(() => result.current.dispatch({ type: VoiceActionType.SetJoinFailure, payload }));
    expect(result.current.state.joinFailure).toMatchObject(payload);
    // A hang-up/reset doesn't hide it
    act(() => result.current.dispatch({ type: VoiceActionType.SetDisconnected }));
    expect(result.current.state.joinFailure).toMatchObject(payload);
    // A new join does
    act(() => result.current.dispatch({ type: VoiceActionType.SetConnecting, payload: true }));
    expect(result.current.state.joinFailure).toBeNull();

    act(() => result.current.dispatch({ type: VoiceActionType.SetJoinFailure, payload }));
    act(() =>
      result.current.dispatch({ type: VoiceActionType.SetDisconnected, payload: { reason: VoiceEndReason.RoomDeleted } }),
    );
    act(() => result.current.dispatch({ type: VoiceActionType.ClearVoiceNotice }));
    expect(result.current.state.joinFailure).toBeNull();
    expect(result.current.state.lastEnded).toBeNull();
  });
});
