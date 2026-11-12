import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../test-utils';
import { act, screen } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { IncomingCallListener } from '../../components/DirectMessage/IncomingCallListener';
import { ServerEvents } from '@semaphore-chat/shared';
import {
  directMessagesControllerFindUserDmGroupsQueryKey,
  dmVoicePresenceControllerGetDmPresenceQueryKey,
} from '../../api-client/@tanstack/react-query.gen';
import type { DmVoicePresenceResponseDto } from '../../api-client';
import { createDmGroup, createDmGroupMember } from '../test-utils';
import { VoiceEndReason, VoiceSessionType } from '../../contexts/VoiceContext';
import type { DirectMessageGroup } from '../../types/direct-message.type';


const events = vi.hoisted(() => ({
  handlers: {} as Record<string, (payload: unknown) => void>,
}));

vi.mock('../../socket-hub/useServerEvent', () => ({
  useServerEvent: (event: string, callback: (payload: unknown) => void) => {
    events.handlers[event] = callback;
  },
}));

const call = vi.hoisted(() => ({
  incomingCall: null as unknown,
  showIncomingCall: vi.fn(),
  dismissCall: vi.fn(),
}));

vi.mock('../../contexts/IncomingCallContext', () => ({
  useIncomingCall: () => ({
    incomingCall: call.incomingCall,
    showIncomingCall: call.showIncomingCall,
    dismissCall: call.dismissCall,
  }),
}));

const current = vi.hoisted(() => ({
  user: { id: 'me', username: 'me_user', displayName: 'Me', avatarUrl: null } as null | {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  },
}));

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: current.user }),
}));

const voice = vi.hoisted(() => ({
  state: {
    isConnected: false,
    contextType: null as string | null,
    currentDmGroupId: null as string | null,
  },
  endVoiceSession: vi.fn(),
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({
    state: voice.state,
    actions: { endVoiceSession: voice.endVoiceSession },
  }),
}));

const sounds = vi.hoisted(() => ({ playSound: vi.fn(), stopSound: vi.fn() }));
vi.mock('../../hooks/useSound', () => ({
  playSound: sounds.playSound,
  stopSound: sounds.stopSound,
  Sounds: { incomingCall: 'incomingCall' },
}));

vi.mock('../../utils/notifications', () => ({
  showNotification: vi.fn(),
}));

import { showNotification } from '../../utils/notifications';

const payload = {
  dmGroupId: 'dm-1',
  startedBy: 'other-user',
  starter: {
    id: 'other-user',
    username: 'alice',
    displayName: 'Alice Smith' as string | null,
    avatarUrl: 'avatar-file-id',
  },
};

function fireCall(overrides: Partial<typeof payload> = {}) {
  const handler = events.handlers[ServerEvents.DM_VOICE_CALL_STARTED];
  if (!handler) throw new Error('listener did not subscribe to DM_VOICE_CALL_STARTED');
  act(() => {
    handler({ ...payload, ...overrides });
  });
}

/** Fire a server event at the listener and let its async work settle. */
async function fire(event: ServerEvents, value: unknown) {
  const handler = events.handlers[event];
  if (!handler) throw new Error(`listener did not subscribe to ${event}`);
  await act(async () => {
    await handler(value);
  });
}

const ringing = {
  dmGroupId: 'dm-1',
  dmGroupName: 'Alice Smith',
  callerName: 'Alice Smith',
  callerAvatar: null,
  startedAt: Date.now(),
};

const presenceOf = (...ids: string[]): DmVoicePresenceResponseDto => ({
  dmGroupId: 'dm-1',
  users: ids.map((id) => ({
    id,
    username: id,
    displayName: id,
    joinedAt: new Date().toISOString(),
    isDeafened: false,
    isServerMuted: false,
  })),
  count: ids.length,
});

function connectToDmCall(dmGroupId: string) {
  voice.state.isConnected = true;
  voice.state.contextType = VoiceSessionType.Dm;
  voice.state.currentDmGroupId = dmGroupId;
}

describe('IncomingCallListener', () => {
  beforeEach(() => {
    events.handlers = {};
    call.incomingCall = null;
    call.showIncomingCall.mockReset();
    call.dismissCall.mockReset();
    current.user = { id: 'me', username: 'me_user', displayName: 'Me', avatarUrl: null };
    voice.state.isConnected = false;
    voice.state.contextType = null;
    voice.state.currentDmGroupId = null;
    sounds.playSound.mockReset();
    sounds.stopSound.mockReset();
    voice.endVoiceSession.mockReset();
    vi.mocked(showNotification).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rings and notifies for a call started by someone else', () => {
    renderWithProviders(<IncomingCallListener />);

    fireCall();

    expect(call.showIncomingCall).toHaveBeenCalledWith(
      expect.objectContaining({
        dmGroupId: 'dm-1',
        dmGroupName: 'Alice Smith',
        callerName: 'Alice Smith',
        callerAvatar: 'avatar-file-id',
      }),
    );
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Alice Smith is calling',
        body: 'Incoming voice call',
        tag: 'dm-call-dm-1',
      }),
    );
  });

  it('falls back to the username when the caller has no display name', () => {
    renderWithProviders(<IncomingCallListener />);

    fireCall({ starter: { ...payload.starter, displayName: null } });

    expect(call.showIncomingCall).toHaveBeenCalledWith(
      expect.objectContaining({ callerName: 'alice' }),
    );
  });

  it('uses the conversation name from the cached DM list', () => {
    const group = createDmGroup({
      id: 'dm-1',
      isGroup: true,
      name: 'Weekend Plans',
      members: [createDmGroupMember({ userId: 'me' })],
    });
    const { queryClient } = renderWithProviders(<IncomingCallListener />);
    queryClient.setQueryData<DirectMessageGroup[]>(
      directMessagesControllerFindUserDmGroupsQueryKey(),
      [group],
    );

    fireCall();

    expect(call.showIncomingCall).toHaveBeenCalledWith(
      expect.objectContaining({ dmGroupName: 'Weekend Plans' }),
    );
  });

  it('ignores a call started by the current user', () => {
    renderWithProviders(<IncomingCallListener />);

    fireCall({ startedBy: 'me' });

    expect(call.showIncomingCall).not.toHaveBeenCalled();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('ignores a call for the DM group the user is already connected to', () => {
    voice.state.isConnected = true;
    voice.state.contextType = VoiceSessionType.Dm;
    voice.state.currentDmGroupId = 'dm-1';
    renderWithProviders(<IncomingCallListener />);

    fireCall();

    expect(call.showIncomingCall).not.toHaveBeenCalled();
  });

  it('still rings for a different DM while connected to another DM call', () => {
    voice.state.isConnected = true;
    voice.state.contextType = VoiceSessionType.Dm;
    voice.state.currentDmGroupId = 'dm-2';
    renderWithProviders(<IncomingCallListener />);

    fireCall();

    expect(call.showIncomingCall).toHaveBeenCalledTimes(1);
  });

  it('does not ring when signed out', () => {
    current.user = null;
    renderWithProviders(<IncomingCallListener />);

    fireCall();

    expect(call.showIncomingCall).not.toHaveBeenCalled();
  });

  it('loops the ring sound about every 3.5s and stops it once the call is dismissed', () => {
    vi.useFakeTimers();
    call.showIncomingCall.mockImplementation((incoming: unknown) => {
      call.incomingCall = incoming;
    });
    const { rerender } = renderWithProviders(<IncomingCallListener />);
    sounds.playSound.mockClear();
    sounds.stopSound.mockClear();

    fireCall();
    rerender(<IncomingCallListener />);

    expect(sounds.playSound).toHaveBeenCalledTimes(1);
    expect(sounds.playSound).toHaveBeenCalledWith('incomingCall');

    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(sounds.playSound).toHaveBeenCalledTimes(2);

    call.incomingCall = null;
    rerender(<IncomingCallListener />);

    expect(sounds.stopSound).toHaveBeenCalledWith('incomingCall');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(sounds.playSound).toHaveBeenCalledTimes(2);
  });

  describe('stopping the ring', () => {
    it('stops when my own account declined on another device', async () => {
      call.incomingCall = ringing;
      renderWithProviders(<IncomingCallListener />);

      await fire(ServerEvents.DM_VOICE_CALL_DECLINED, { dmGroupId: 'dm-1', userId: 'me' });

      expect(call.dismissCall).toHaveBeenCalledTimes(1);
      expect(voice.endVoiceSession).not.toHaveBeenCalled();
    });

    it('keeps ringing when someone else declines', async () => {
      call.incomingCall = ringing;
      renderWithProviders(<IncomingCallListener />);

      await fire(ServerEvents.DM_VOICE_CALL_DECLINED, { dmGroupId: 'dm-1', userId: 'other-user' });

      expect(call.dismissCall).not.toHaveBeenCalled();
    });

    it('keeps ringing for a decline in another DM', async () => {
      call.incomingCall = ringing;
      renderWithProviders(<IncomingCallListener />);

      await fire(ServerEvents.DM_VOICE_CALL_DECLINED, { dmGroupId: 'dm-2', userId: 'me' });

      expect(call.dismissCall).not.toHaveBeenCalled();
    });

    it('stops when I answered on another device', async () => {
      call.incomingCall = ringing;
      renderWithProviders(<IncomingCallListener />);

      await fire(ServerEvents.DM_VOICE_USER_JOINED, {
        dmGroupId: 'dm-1',
        user: { id: 'me', username: 'me_user' },
      });

      expect(call.dismissCall).toHaveBeenCalledTimes(1);
    });

    it('keeps ringing when someone else joins', async () => {
      call.incomingCall = ringing;
      renderWithProviders(<IncomingCallListener />);

      await fire(ServerEvents.DM_VOICE_USER_JOINED, {
        dmGroupId: 'dm-1',
        user: { id: 'other-user', username: 'alice' },
      });

      expect(call.dismissCall).not.toHaveBeenCalled();
    });

    it('stops when the caller gives up', async () => {
      call.incomingCall = ringing;
      renderWithProviders(<IncomingCallListener />);

      await fire(ServerEvents.DM_VOICE_CALL_ENDED, { dmGroupId: 'dm-1' });

      expect(call.dismissCall).toHaveBeenCalledTimes(1);
    });

    it('keeps ringing for a call ended in another DM', async () => {
      call.incomingCall = ringing;
      renderWithProviders(<IncomingCallListener />);

      await fire(ServerEvents.DM_VOICE_CALL_ENDED, { dmGroupId: 'dm-2' });

      expect(call.dismissCall).not.toHaveBeenCalled();
    });
  });

  describe('the caller when the other person declines a 1:1 call', () => {
    function cacheDm(queryClient: QueryClient, isGroup: boolean) {
      const group = createDmGroup({ id: 'dm-1', isGroup, members: [createDmGroupMember({ userId: 'me' })] });
      queryClient.setQueryData<DirectMessageGroup[]>(directMessagesControllerFindUserDmGroupsQueryKey(), [group]);
    }

    it('leaves the call with a "Call declined" notice', async () => {
      connectToDmCall('dm-1');
      const { queryClient } = renderWithProviders(<IncomingCallListener />);
      cacheDm(queryClient, false);
      queryClient.setQueryData(
        dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId: 'dm-1' } }),
        presenceOf('me'),
      );

      await fire(ServerEvents.DM_VOICE_CALL_DECLINED, { dmGroupId: 'dm-1', userId: 'other-user' });

      expect(voice.endVoiceSession).toHaveBeenCalledWith(VoiceEndReason.CallDeclined);
    });

    it('leaves a 1:1 call on the server\'s word when the DM-groups cache is empty', async () => {
      connectToDmCall('dm-1');
      const { queryClient } = renderWithProviders(<IncomingCallListener />);
      queryClient.setQueryData(
        dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId: 'dm-1' } }),
        presenceOf('me'),
      );

      await fire(ServerEvents.DM_VOICE_CALL_DECLINED, { dmGroupId: 'dm-1', userId: 'other-user', isGroup: false });

      expect(voice.endVoiceSession).toHaveBeenCalledWith(VoiceEndReason.CallDeclined);
    });

    it('stays in a group call on the server\'s word even when the cache says 1:1', async () => {
      connectToDmCall('dm-1');
      const { queryClient } = renderWithProviders(<IncomingCallListener />);
      cacheDm(queryClient, false);
      queryClient.setQueryData(
        dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId: 'dm-1' } }),
        presenceOf('me'),
      );

      await fire(ServerEvents.DM_VOICE_CALL_DECLINED, { dmGroupId: 'dm-1', userId: 'other-user', isGroup: true });

      expect(voice.endVoiceSession).not.toHaveBeenCalled();
    });

    it('stays in the call when neither the server nor the cache says it is 1:1', async () => {
      connectToDmCall('dm-1');
      const { queryClient } = renderWithProviders(<IncomingCallListener />);
      queryClient.setQueryData(
        dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId: 'dm-1' } }),
        presenceOf('me'),
      );

      await fire(ServerEvents.DM_VOICE_CALL_DECLINED, { dmGroupId: 'dm-1', userId: 'other-user' });

      expect(voice.endVoiceSession).not.toHaveBeenCalled();
    });

    it('stays in a group call', async () => {
      connectToDmCall('dm-1');
      const { queryClient } = renderWithProviders(<IncomingCallListener />);
      cacheDm(queryClient, true);
      queryClient.setQueryData(
        dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId: 'dm-1' } }),
        presenceOf('me'),
      );

      await fire(ServerEvents.DM_VOICE_CALL_DECLINED, { dmGroupId: 'dm-1', userId: 'other-user' });

      expect(voice.endVoiceSession).not.toHaveBeenCalled();
    });

    it('does nothing when the call is not mine', async () => {
      const { queryClient } = renderWithProviders(<IncomingCallListener />);
      cacheDm(queryClient, false);
      queryClient.setQueryData(
        dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId: 'dm-1' } }),
        presenceOf('other-user'),
      );

      await fire(ServerEvents.DM_VOICE_CALL_DECLINED, { dmGroupId: 'dm-1', userId: 'other-user' });

      expect(voice.endVoiceSession).not.toHaveBeenCalled();
    });

    it('does not end a 1:1 call someone else is still in', async () => {
      connectToDmCall('dm-1');
      const { queryClient } = renderWithProviders(<IncomingCallListener />);
      cacheDm(queryClient, false);
      queryClient.setQueryData(
        dmVoicePresenceControllerGetDmPresenceQueryKey({ path: { dmGroupId: 'dm-1' } }),
        presenceOf('me', 'third-person'),
      );

      await fire(ServerEvents.DM_VOICE_CALL_DECLINED, { dmGroupId: 'dm-1', userId: 'other-user' });

      expect(voice.endVoiceSession).not.toHaveBeenCalled();
    });
  });

  it('renders nothing', () => {
    const { container } = renderWithProviders(<IncomingCallListener />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
