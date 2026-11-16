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
 * the grant arrives and again after a lifted mute (the server unpublishes the
 * track with the grant). `play()` still publishes lazily as a fallback.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Room } from 'livekit-client';
import { VoiceSessionType } from '../contexts/VoiceContext';
import { soundboardPlayer } from '../features/voice/soundboardPlayer';
import {
  PARTICIPANT_EVENT,
  PROTO_TRACK_SOURCE_UNKNOWN,
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

/** The local participant's grant for the soundboard, kept current through `participantPermissionsChanged`. */
function useSoundboardGrant(room: Room | null): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const participant = room?.localParticipant;
      if (!participant) return noop;
      participant.on(PARTICIPANT_EVENT.ParticipantPermissionsChanged, onChange);
      return () => {
        participant.off(PARTICIPANT_EVENT.ParticipantPermissionsChanged, onChange);
      };
    },
    [room],
  );
  const read = useCallback(() => soundboardGrantAllows(room?.localParticipant?.permissions), [room]);
  return useSyncExternalStore(subscribe, read, () => false);
}

export interface SoundboardWarmupOptions {
  /** The channel lets the user speak (`useVoicePublishPermissions().canSpeak`; false while timed out). */
  canSpeak: boolean;
}

export function useSoundboardWarmup({ canSpeak }: SoundboardWarmupOptions): void {
  const { state } = useVoiceConnection();
  const { room, isConnected, contextType, communityId, isServerMuted } = state;
  const granted = useSoundboardGrant(room);
  // Community calls only: a DM call has no soundboard.
  const ready =
    room !== null &&
    isConnected &&
    contextType === VoiceSessionType.Channel &&
    Boolean(communityId) &&
    !isServerMuted &&
    canSpeak &&
    granted;

  useEffect(() => {
    if (!ready || !room) return;
    // Idempotent: a track already published (or a publish already running) is reused.
    void soundboardPlayer.warmup(room);
  }, [ready, room]);
}
