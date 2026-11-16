/**
 * The one owner of the soundboard warm-up: publishing the (silent) soundboard
 * track early in a community call, so peers have subscribed to it before the
 * first clip plays (a publish on first play races their subscription and clips
 * the sound).
 *
 * It runs in VoiceSessionEffects, above both shells and every layout, so a
 * call joined from anywhere (a classic channel page, a Lounge room card)
 * publishes the track exactly once, and a later shell, layout or breakpoint
 * change publishes nothing new (every peer would otherwise get a new audio
 * element). The classic soundboard button and bar no longer warm up.
 *
 * It publishes only while the server allows it: the user is not server-muted,
 * may speak in the channel, and the local participant's current grant lets it
 * publish the soundboard's source (UNKNOWN). A restricted member's join token
 * never carries UNKNOWN (the participant_joined webhook adds it shortly after),
 * and a server mute takes it away; a publish then is refused, and a refused
 * publish can leave the user unheard after the mute is lifted (#815). The grant
 * is re-read on every `participantPermissionsChanged`, so the warm-up runs once
 * the grant arrives, and again after a lifted mute (the server unpublishes the
 * track with the grant).
 *
 * It never publishes alongside the microphone. A server mute unpublishes the
 * mic too, and the user usually unmutes right after the mute is lifted; two
 * audio publishes in flight together can end up under one track on the server,
 * and peers then get the silent soundboard where the mic should be (seen in the
 * mute-permissions voice spec). So once this call has had a published mic, the
 * warm-up waits until the mic is published again. A user who never had one (who
 * joined muted) warms up at once. `play()` still publishes lazily as a fallback.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Room } from 'livekit-client';
import { VoiceSessionType } from '../contexts/VoiceContext';
import { soundboardPlayer } from '../features/voice/soundboardPlayer';
import {
  PARTICIPANT_EVENT,
  PROTO_TRACK_SOURCE_UNKNOWN,
  TRACK_SOURCE,
  type ParticipantPermission,
} from '../features/voice/livekitEvents';
import { useVoiceConnection } from './useVoiceConnection';

/**
 * Whether a grant lets the local participant publish the soundboard track, by
 * livekit-client's own rule (`hasPermissionsToPublish`): `canPublish`, and
 * either no source list (every source) or one that names UNKNOWN. No grant
 * known yet: no.
 */
export function soundboardGrantAllows(permissions: ParticipantPermission | undefined): boolean {
  if (!permissions?.canPublish) return false;
  const sources = permissions.canPublishSources ?? [];
  return sources.length === 0 || sources.includes(PROTO_TRACK_SOURCE_UNKNOWN);
}

const noop = () => undefined;

/** The local participant's event API, as far as this hook uses it. */
interface LocalEmitter {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}

/** A value read from the room's local participant, kept current through its events. */
function useLocalParticipantValue(room: Room | null, events: readonly string[], read: (room: Room) => boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      // Only the events' names are used, as strings (no runtime livekit-client import here).
      const participant = room?.localParticipant as unknown as LocalEmitter | undefined;
      if (!participant) return noop;
      for (const event of events) participant.on(event, onChange);
      return () => {
        for (const event of events) participant.off(event, onChange);
      };
    },
    // `events` is a module constant at each call site: stable.
    [room, events],
  );
  const get = useCallback(() => (room?.localParticipant ? read(room) : false), [room, read]);
  return useSyncExternalStore(subscribe, get, () => false);
}

const GRANT_EVENTS = [PARTICIPANT_EVENT.ParticipantPermissionsChanged] as const;
const TRACK_EVENTS = [PARTICIPANT_EVENT.LocalTrackPublished, PARTICIPANT_EVENT.LocalTrackUnpublished] as const;

const readGrant = (room: Room) => soundboardGrantAllows(room.localParticipant.permissions);
const readMicPublished = (room: Room) => {
  for (const publication of room.localParticipant.trackPublications.values()) {
    if (publication.source === TRACK_SOURCE.Microphone) return true;
  }
  return false;
};

export interface SoundboardWarmupOptions {
  /** The channel lets the user speak (`useVoicePublishPermissions().canSpeak`; false while timed out). */
  canSpeak: boolean;
}

export function useSoundboardWarmup({ canSpeak }: SoundboardWarmupOptions): void {
  const { state } = useVoiceConnection();
  const { room, isConnected, contextType, communityId, isServerMuted } = state;
  const granted = useLocalParticipantValue(room, GRANT_EVENTS, readGrant);
  const micPublished = useLocalParticipantValue(room, TRACK_EVENTS, readMicPublished);

  // The room whose mic has been published at least once (state adjusted during render, not in an effect).
  const [hadMicIn, setHadMicIn] = useState<Room | null>(null);
  if (micPublished && room !== null && hadMicIn !== room) setHadMicIn(room);
  const micSettled = micPublished || hadMicIn !== room;

  // Community calls only: a DM call has no soundboard.
  const ready =
    room !== null &&
    isConnected &&
    contextType === VoiceSessionType.Channel &&
    Boolean(communityId) &&
    !isServerMuted &&
    canSpeak &&
    granted &&
    micSettled;

  useEffect(() => {
    if (!ready || !room) return;
    // Idempotent: a track already published (or a publish already running) is reused.
    void soundboardPlayer.warmup(room);
  }, [ready, room]);
}
