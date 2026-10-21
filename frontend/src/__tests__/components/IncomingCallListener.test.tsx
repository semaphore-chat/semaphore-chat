import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../test-utils';
import { act, screen } from '@testing-library/react';
import { IncomingCallListener } from '../../components/DirectMessage/IncomingCallListener';
import { ServerEvents } from '@semaphore-chat/shared';
import { directMessagesControllerFindUserDmGroupsQueryKey } from '../../api-client/@tanstack/react-query.gen';
import { createDmGroup, createDmGroupMember } from '../test-utils';
import { VoiceSessionType } from '../../contexts/VoiceContext';
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
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: voice.state, actions: {} }),
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

  it('renders nothing', () => {
    const { container } = renderWithProviders(<IncomingCallListener />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
