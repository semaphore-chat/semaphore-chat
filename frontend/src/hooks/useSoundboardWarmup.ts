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
 * and a server mute takes it away (the server unpublishes the track). The grant
 * is re-read on every `participantPermissionsChanged`, so the warm-up runs once
 * the grant arrives, and again after a lifted mute.
 *
 * It publishes only while the Room is `connected`. During a full reconnect
 * LiveKit unpublishes and republishes every local track itself (the soundboard
 * included) while the Room is `reconnecting`; a warm-up then would find no
 * soundboard yet and publish a second one.
 *
 * After a lifted server mute it does not publish alongside the microphone. The
 * user usually unmutes right after the lift; two audio publishes in flight
 * together can end up under one track on the server, and peers then get the
 * silent soundboard where the mic should be (seen in the mute-permissions voice
 * spec). So after a lift the warm-up waits until the mic is published, or, for a
 * user who stays muted (or joined muted, or uses push-to-talk), for
 * MIC_AFTER_LIFT_WAIT_MS. `play()` still publishes on demand as a fallback.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Room } from 'livekit-client';
import { VoiceSessionType } from '../contexts/VoiceContext';
import { soundboardPlayer } from '../features/voice/soundboardPlayer';
import {
  CONNECTION_STATE,
  PARTICIPANT_EVENT,
  PROTO_TRACK_SOURCE_UNKNOWN,
  ROOM_EVENT,
  TRACK_SOURCE,
  type ParticipantPermission,
} from '../features/voice/livekitEvents';
import { useVoiceConnection } from './useVoiceConnection';

/** How long, after a lifted server mute, the warm-up waits for the user to unmute before publishing anyway. */
export const MIC_AFTER_LIFT_WAIT_MS = 5_000;

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

/** An event emitter's API, as far as this hook uses it (the Room and its local participant). */
interface Emitter {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}

/**
 * A value read from the Room (or its local participant), kept current through its events. Only the
 * events' names are used, as strings (no runtime livekit-client import here).
 */
function useRoomValue(
  room: Room | null,
  source: (room: Room) => unknown,
  events: readonly string[],
  read: (room: Room) => boolean,
): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const emitter = room ? (source(room) as Emitter | undefined) : undefined;
      if (!emitter) return noop;
      for (const event of events) emitter.on(event, onChange);
      return () => {
        for (const event of events) emitter.off(event, onChange);
      };
    },
    // `source` and `events` are module constants at each call site: stable.
    [room, source, events],
  );
  const get = useCallback(() => (room?.localParticipant ? read(room) : false), [room, read]);
  return useSyncExternalStore(subscribe, get, () => false);
}

const localParticipantOf = (room: Room) => room.localParticipant;
const roomItself = (room: Room) => room;
const GRANT_EVENTS = [PARTICIPANT_EVENT.ParticipantPermissionsChanged] as const;
const TRACK_EVENTS = [PARTICIPANT_EVENT.LocalTrackPublished, PARTICIPANT_EVENT.LocalTrackUnpublished] as const;
const STATE_EVENTS = [ROOM_EVENT.ConnectionStateChanged] as const;

const readGrant = (room: Room) => soundboardGrantAllows(room.localParticipant.permissions);
const readMicPublished = (room: Room) => {
  for (const publication of room.localParticipant.trackPublications.values()) {
    if (publication.source === TRACK_SOURCE.Microphone) return true;
  }
  return false;
};
const readConnected = (room: Room) => room.state === CONNECTION_STATE.Connected;

/** Where the mute-lift wait of a room stands: muted now, or lifted and waiting for the mic (or the timeout). */
type LiftWait = { room: Room; phase: 'muted' | 'waiting' } | null;

export interface SoundboardWarmupOptions {
  /** The channel lets the user speak (`useVoicePublishPermissions().canSpeak`; false while timed out). */
  canSpeak: boolean;
}

export function useSoundboardWarmup({ canSpeak }: SoundboardWarmupOptions): void {
  const { state } = useVoiceConnection();
  const { room, isConnected, contextType, communityId, isServerMuted } = state;
  const granted = useRoomValue(room, localParticipantOf, GRANT_EVENTS, readGrant);
  const micPublished = useRoomValue(room, localParticipantOf, TRACK_EVENTS, readMicPublished);
  const roomConnected = useRoomValue(room, roomItself, STATE_EVENTS, readConnected);

  // The lift wait, adjusted during render (not in an effect): armed by a server mute, waiting once it is
  // lifted, done when the mic is published (or by the timer below).
  const [liftWait, setLiftWait] = useState<LiftWait>(null);
  if (room !== null && isServerMuted && !(liftWait?.room === room && liftWait.phase === 'muted')) {
    setLiftWait({ room, phase: 'muted' });
  } else if (liftWait !== null && liftWait.room === room && liftWait.phase === 'muted' && !isServerMuted) {
    setLiftWait({ room, phase: 'waiting' });
  } else if (liftWait !== null && liftWait.room === room && liftWait.phase === 'waiting' && micPublished) {
    setLiftWait(null);
  }
  useEffect(() => {
    if (liftWait?.phase !== 'waiting') return undefined;
    // A user who stays muted: publish anyway after a while, so the first clip is not clipped.
    const timer = setTimeout(() => setLiftWait((now) => (now === liftWait ? null : now)), MIC_AFTER_LIFT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [liftWait]);
  const liftSettled = !(liftWait !== null && liftWait.room === room);

  // Community calls only: a DM call has no soundboard.
  const ready =
    room !== null &&
    isConnected &&
    roomConnected &&
    contextType === VoiceSessionType.Channel &&
    Boolean(communityId) &&
    !isServerMuted &&
    canSpeak &&
    granted &&
    liftSettled;

  useEffect(() => {
    if (!ready || !room) return;
    // Idempotent: a track already published (or a publish already running) is reused.
    void soundboardPlayer.warmup(room);
  }, [ready, room]);
}
