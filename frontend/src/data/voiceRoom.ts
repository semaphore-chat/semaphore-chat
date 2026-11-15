/**
 * Who is in a voice room, and joining one.
 *
 * People come from LiveKit when you are in the room (instant, includes you
 * before the server's presence catches up) and from the server's presence
 * query otherwise (design F8). Both shells read this, so the classic sidebar
 * and the new shell's voice card always agree.
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 * No livekit-client values: the room arrives through the voice context and its
 * events are named through `features/voice/livekitEvents`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ServerEvents } from '@semaphore-chat/shared';
import { voicePresenceControllerGetChannelPresenceOptions } from '../api-client/@tanstack/react-query.gen';
import type { VoicePresenceUserDto } from '../api-client/types.gen';
import { ChannelType, type Channel } from '../types/channel.type';
import { useVoiceConnection } from '../hooks/useVoiceConnection';
import { useSpeaking } from '../hooks/useSpeaking';
import { playSound, Sounds } from '../hooks/useSound';
import { ROOM_EVENT } from '../features/voice/livekitEvents';
import { getUserInfo } from '../features/users/userApiHelpers';
import { useServerEvent } from '../socket-hub/useServerEvent';
import { logger } from '../utils/logger';
import type { QueryStatus } from './channels';

export interface VoiceRoomPerson {
  id: string;
  name: string;
  avatarFileId: string | null;
  deafened: boolean;
  serverMuted: boolean;
}

export interface VoiceRoomPeople {
  /** The room's people, in the source's order. */
  people: VoiceRoomPerson[];
  /** The same people as the presence DTO (what the classic list renders). */
  users: VoicePresenceUserDto[];
  /** How many are here (the server's count when read from presence). */
  count: number;
  /** Who is speaking; only known in your own room (empty elsewhere). */
  speaking: ReadonlySet<string>;
  youAreHere: boolean;
  /** Your LiveKit identity while you are in any call. */
  localIdentity: string | undefined;
  status: QueryStatus;
  isLoading: boolean;
  error: unknown;
}

/** Pure: the presence DTO as a person. */
export function toVoiceRoomPerson(user: VoicePresenceUserDto): VoiceRoomPerson {
  return {
    id: user.id,
    name: user.displayName || user.username,
    avatarFileId: user.avatarUrl ?? null,
    deafened: user.isDeafened,
    serverMuted: user.isServerMuted,
  };
}

const NOBODY: ReadonlySet<string> = new Set();

interface LiveKitParticipantLike {
  identity: string;
  name?: string;
  metadata?: string;
}

function readDeafened(participant: LiveKitParticipantLike): boolean {
  try {
    if (participant.metadata) {
      return (JSON.parse(participant.metadata) as { isDeafened?: boolean }).isDeafened ?? false;
    }
  } catch {
    /* ignore malformed metadata */
  }
  return false;
}

export function useVoiceRoomPeople(channel: Pick<Channel, 'id' | 'type'>): VoiceRoomPeople {
  const { state: voiceState } = useVoiceConnection();
  const { speakingMap } = useSpeaking();
  const [livekitParticipants, setLivekitParticipants] = useState<VoicePresenceUserDto[]>([]);

  const youAreHere = voiceState.currentChannelId === channel.id && voiceState.isConnected;
  const isVoice = channel.type === ChannelType.VOICE;

  // The server's presence, only when NOT in this room (LiveKit is the source there).
  const {
    data: backendPresence,
    status: backendStatus,
    isLoading: backendLoading,
    error: backendError,
  } = useQuery({
    ...voicePresenceControllerGetChannelPresenceOptions({ path: { channelId: channel.id } }),
    enabled: isVoice && !youAreHere,
    refetchInterval: 120_000,
  });

  // In this room: the participants straight from LiveKit.
  useEffect(() => {
    if (!youAreHere || !voiceState.room) {
      setLivekitParticipants([]);
      return;
    }

    const room = voiceState.room;
    let updateVersion = 0;

    const updateParticipants = async () => {
      const version = ++updateVersion;

      const allParticipants: { identity: string; name: string | undefined; isDeafened: boolean }[] = [];
      const local = room.localParticipant;
      if (local && local.identity) {
        allParticipants.push({ identity: local.identity, name: local.name || undefined, isDeafened: readDeafened(local) });
      }
      room.remoteParticipants.forEach((participant) => {
        allParticipants.push({
          identity: participant.identity,
          name: participant.name || undefined,
          isDeafened: readDeafened(participant),
        });
      });

      const userInfos = await Promise.all(allParticipants.map((p) => getUserInfo(p.identity)));

      // Discard stale updates if a newer one was started
      if (version !== updateVersion) return;

      setLivekitParticipants(
        allParticipants.map((p, i) => ({
          id: p.identity,
          username: p.name || p.identity,
          displayName: p.name || undefined,
          avatarUrl: userInfos[i]?.avatarUrl ?? undefined,
          // Not shown anywhere; the DTO requires it
          joinedAt: new Date().toISOString(),
          isDeafened: p.isDeafened,
          // LiveKit metadata doesn't carry server mute; the socket event below does
          isServerMuted: false,
        })),
      );
    };

    // Debounce rapid event bursts (e.g. multiple participants joining at once)
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => updateParticipants(), 100);
    };

    void updateParticipants();

    const events = [
      ROOM_EVENT.ParticipantConnected,
      ROOM_EVENT.ParticipantDisconnected,
      ROOM_EVENT.Connected,
      ROOM_EVENT.ParticipantMetadataChanged,
    ] as const;
    events.forEach((event) => room.on(event, debouncedUpdate));

    return () => {
      updateVersion++; // Invalidate any in-flight async updates
      if (debounceTimer) clearTimeout(debounceTimer);
      events.forEach((event) => room.off(event, debouncedUpdate));
    };
  }, [youAreHere, voiceState.room]);

  // Server mute for the LiveKit list comes from the socket (LiveKit metadata lacks it).
  useServerEvent(ServerEvents.VOICE_CHANNEL_USER_UPDATED, (payload) => {
    if (!youAreHere || payload.channelId !== channel.id) return;
    setLivekitParticipants((prev) =>
      prev.map((p) => (p.id === payload.userId ? { ...p, isServerMuted: payload.user.isServerMuted ?? false } : p)),
    );
  });

  const users = useMemo(
    () => (youAreHere ? livekitParticipants : (backendPresence?.users ?? [])),
    [youAreHere, livekitParticipants, backendPresence],
  );
  const people = useMemo(() => users.map(toVoiceRoomPerson), [users]);

  const speaking = useMemo<ReadonlySet<string>>(() => {
    if (!youAreHere) return NOBODY;
    const ids = new Set<string>();
    for (const user of users) if (speakingMap.get(user.id)) ids.add(user.id);
    return ids;
  }, [youAreHere, users, speakingMap]);

  return {
    people,
    users,
    count: youAreHere ? users.length : (backendPresence?.count ?? 0),
    speaking,
    youAreHere,
    localIdentity: voiceState.room?.localParticipant?.identity,
    status: youAreHere ? 'success' : backendStatus,
    isLoading: !youAreHere && backendLoading,
    error: youAreHere ? null : backendError,
  };
}

/** `busy`: a join started from this hook is still running (a double tap). */
export type JoinVoiceRoomOutcome = 'joined' | 'alreadyHere' | 'failed' | 'busy';

/**
 * Join a community voice room. Never navigates (the classic row navigates on
 * the outcome; the new shell stays). A failure logs and plays the error
 * sound; the voice notice (`useVoiceNotice`) explains it and offers Retry.
 */
export function useJoinVoiceRoom(): (
  channel: Pick<Channel, 'id' | 'name' | 'communityId' | 'isPrivate' | 'createdAt'>,
  /** Defaults to the channel's own community. */
  communityId?: string,
) => Promise<JoinVoiceRoomOutcome> {
  const { state, actions } = useVoiceConnection();
  const { currentChannelId, isConnected } = state;
  const { joinVoiceChannel } = actions;
  // One join at a time per caller: a second tap while the first runs does nothing.
  const joiningRef = useRef(false);
  return useCallback(
    async (channel, communityId = channel.communityId) => {
      if (currentChannelId === channel.id && isConnected) return 'alreadyHere';
      if (joiningRef.current) return 'busy';
      joiningRef.current = true;
      try {
        await joinVoiceChannel(channel.id, channel.name, communityId, channel.isPrivate || false, channel.createdAt);
        return 'joined';
      } catch (error) {
        logger.error('Failed to join voice channel:', error);
        playSound(Sounds.error);
        return 'failed';
      } finally {
        joiningRef.current = false;
      }
    },
    [currentChannelId, isConnected, joinVoiceChannel],
  );
}
