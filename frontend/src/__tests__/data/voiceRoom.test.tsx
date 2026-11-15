import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { ServerEvents } from '@semaphore-chat/shared';
import { server } from '../msw/server';
import { createTestQueryClient, createChannel } from '../test-utils';
import { createTestHubWrapper } from '../test-utils/wrappers';
import { createEventBus } from '../../socket-hub/emitter';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const voice = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  joinVoiceChannel: vi.fn(),
}));
vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: voice.state, actions: { joinVoiceChannel: voice.joinVoiceChannel } }),
}));
vi.mock('../../features/users/userApiHelpers', () => ({
  getUserInfo: vi.fn(async (id: string) => ({ avatarUrl: `avatar-${id}` })),
}));
const mockPlaySound = vi.fn();
vi.mock('../../hooks/useSound', () => ({
  playSound: (...args: unknown[]) => mockPlaySound(...args),
  Sounds: { error: 'error' },
}));
vi.mock('../../utils/logger', () => ({
  logger: { dev: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useVoiceRoomPeople, useJoinVoiceRoom, toVoiceRoomPerson } from '../../data/voiceRoom';
import { handleVoiceUserJoined } from '../../socket-hub/handlers/voiceHandlers';
import { SpeakingContext } from '../../contexts/SpeakingContextDef';
import { logger } from '../../utils/logger';

const BASE = 'http://localhost:3000';
const room = createChannel({ id: 'vc-1', name: 'Squad Up', type: 'VOICE', communityId: 'c-1' });

const presenceUser = (id: string, name: string) => ({
  id,
  username: name.toLowerCase(),
  displayName: name,
  avatarUrl: `file-${id}`,
  joinedAt: '2026-01-01T00:00:00Z',
  isDeafened: false,
  isServerMuted: false,
});

/** A LiveKit room, as far as the hook reads it. */
function fakeRoom(local: { identity: string; name: string }, remotes: { identity: string; name: string; metadata?: string }[]) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    localParticipant: { ...local, metadata: undefined },
    remoteParticipants: new Map(remotes.map((r) => [r.identity, r])),
    on(event: string, fn: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: () => void) {
      listeners.get(event)?.delete(fn);
    },
    emit(event: string) {
      listeners.get(event)?.forEach((fn) => fn());
    },
  };
}

function setup(speaking = new Map<string, boolean>()) {
  const queryClient = createTestQueryClient();
  const eventBus = createEventBus();
  const Hub = createTestHubWrapper({ queryClient, eventBus });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Hub>
      <SpeakingContext.Provider value={{ speakingMap: speaking, isSpeaking: (id) => !!speaking.get(id) }}>
        {children}
      </SpeakingContext.Provider>
    </Hub>
  );
  return { queryClient, eventBus, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  voice.state = { isConnected: false, currentChannelId: null, room: null };
});

describe('useVoiceRoomPeople', () => {
  it('reads the server presence when you are not in the room', async () => {
    server.use(
      http.get(`${BASE}/api/channels/vc-1/voice-presence`, () =>
        HttpResponse.json({ channelId: 'vc-1', users: [presenceUser('u-1', 'Dropbear'), presenceUser('u-2', 'Pri')], count: 2 }),
      ),
    );
    const { wrapper } = setup(new Map([['u-1', true]]));
    const { result } = renderHook(() => useVoiceRoomPeople(room), { wrapper });

    expect(result.current.status).toBe('pending');
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.youAreHere).toBe(false);
    expect(result.current.count).toBe(2);
    expect(result.current.people).toEqual([
      { id: 'u-1', name: 'Dropbear', avatarFileId: 'file-u-1', deafened: false, serverMuted: false },
      { id: 'u-2', name: 'Pri', avatarFileId: 'file-u-2', deafened: false, serverMuted: false },
    ]);
    // Speaking is only known in your own room
    expect(result.current.speaking.size).toBe(0);
  });

  it('follows the voice socket handler (someone joins)', async () => {
    server.use(
      http.get(`${BASE}/api/channels/vc-1/voice-presence`, () =>
        HttpResponse.json({ channelId: 'vc-1', users: [presenceUser('u-1', 'Dropbear')], count: 1 }),
      ),
    );
    const { wrapper, queryClient } = setup();
    const { result } = renderHook(() => useVoiceRoomPeople(room), { wrapper });
    await waitFor(() => expect(result.current.people).toHaveLength(1));

    act(() => {
      handleVoiceUserJoined(
        { channelId: 'vc-1', user: { id: 'u-3', username: 'aiko', displayName: 'Aiko', isDeafened: true, isServerMuted: false } } as never,
        queryClient,
      );
    });

    await waitFor(() => expect(result.current.people.map((p) => p.name)).toEqual(['Dropbear', 'Aiko']));
    expect(result.current.people[1].deafened).toBe(true);
  });

  it('reads LiveKit when you are in the room: you, the others, speaking and server mute', async () => {
    const presence = vi.fn(() => HttpResponse.json({ channelId: 'vc-1', users: [], count: 0 }));
    server.use(http.get(`${BASE}/api/channels/vc-1/voice-presence`, presence));
    const lk = fakeRoom({ identity: 'me', name: 'Me' }, [
      { identity: 'u-1', name: 'Dropbear', metadata: JSON.stringify({ isDeafened: true }) },
    ]);
    voice.state = { isConnected: true, currentChannelId: 'vc-1', room: lk };
    const { wrapper, eventBus } = setup(new Map([['u-1', true], ['me', false]]));
    const { result } = renderHook(() => useVoiceRoomPeople(room), { wrapper });

    await waitFor(() => expect(result.current.people).toHaveLength(2));
    expect(result.current.youAreHere).toBe(true);
    expect(result.current.status).toBe('success');
    expect(result.current.localIdentity).toBe('me');
    expect(result.current.people).toEqual([
      { id: 'me', name: 'Me', avatarFileId: 'avatar-me', deafened: false, serverMuted: false },
      { id: 'u-1', name: 'Dropbear', avatarFileId: 'avatar-u-1', deafened: true, serverMuted: false },
    ]);
    expect([...result.current.speaking]).toEqual(['u-1']);
    // LiveKit is the source here: the server's presence is never asked
    expect(presence).not.toHaveBeenCalled();

    // A moderator mutes u-1: the socket event carries it (LiveKit metadata does not)
    act(() => {
      eventBus.emit(ServerEvents.VOICE_CHANNEL_USER_UPDATED, {
        channelId: 'vc-1',
        userId: 'u-1',
        user: { id: 'u-1', isServerMuted: true },
      } as never);
    });
    expect(result.current.people[1].serverMuted).toBe(true);

    // Someone joins LiveKit (debounced)
    lk.remoteParticipants.set('u-2', { identity: 'u-2', name: 'Pri' });
    act(() => lk.emit('participantConnected'));
    await waitFor(() => expect(result.current.people.map((p) => p.id)).toEqual(['me', 'u-1', 'u-2']));
  });

  it('maps the presence DTO to a person (display name, else username)', () => {
    expect(toVoiceRoomPerson({ ...presenceUser('u-9', 'X'), displayName: undefined, avatarUrl: undefined }).name).toBe('x');
    expect(toVoiceRoomPerson({ ...presenceUser('u-9', 'X'), avatarUrl: undefined }).avatarFileId).toBeNull();
  });
});

describe('useJoinVoiceRoom', () => {
  it('joins and reports it, without navigating', async () => {
    voice.joinVoiceChannel.mockResolvedValue(undefined);
    const { wrapper } = setup();
    const { result } = renderHook(() => useJoinVoiceRoom(), { wrapper });

    await expect(result.current(room)).resolves.toBe('joined');
    expect(voice.joinVoiceChannel).toHaveBeenCalledWith('vc-1', 'Squad Up', 'c-1', false, room.createdAt);
  });

  it('uses the given community over the channel’s own', async () => {
    voice.joinVoiceChannel.mockResolvedValue(undefined);
    const { wrapper } = setup();
    const { result } = renderHook(() => useJoinVoiceRoom(), { wrapper });
    await result.current({ ...room, isPrivate: true }, 'c-route');
    expect(voice.joinVoiceChannel).toHaveBeenCalledWith('vc-1', 'Squad Up', 'c-route', true, room.createdAt);
  });

  it('a second tap while the first join runs starts no second join', async () => {
    let finish!: () => void;
    voice.joinVoiceChannel.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const { wrapper } = setup();
    const { result } = renderHook(() => useJoinVoiceRoom(), { wrapper });

    const first = result.current(room);
    await expect(result.current(room)).resolves.toBe('busy');
    finish();
    await expect(first).resolves.toBe('joined');
    expect(voice.joinVoiceChannel).toHaveBeenCalledTimes(1);
    // Free again afterwards
    voice.joinVoiceChannel.mockResolvedValue(undefined);
    await expect(result.current(room)).resolves.toBe('joined');
  });

  it('does not join again when you are already here', async () => {
    voice.state = { isConnected: true, currentChannelId: 'vc-1', room: null };
    const { wrapper } = setup();
    const { result } = renderHook(() => useJoinVoiceRoom(), { wrapper });

    await expect(result.current(room)).resolves.toBe('alreadyHere');
    expect(voice.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it('a failed join plays the error sound, logs and reports failure (the notice explains it)', async () => {
    voice.joinVoiceChannel.mockRejectedValue(new Error('room is gone'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useJoinVoiceRoom(), { wrapper });

    await expect(result.current(room)).resolves.toBe('failed');
    expect(mockPlaySound).toHaveBeenCalledWith('error');
    expect(logger.error).toHaveBeenCalled();
  });
});
