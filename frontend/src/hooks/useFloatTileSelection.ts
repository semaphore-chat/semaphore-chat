import { useEffect, useMemo, useRef, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type {
  Room,
  Participant,
  RemoteParticipant,
  LocalParticipant,
  TrackPublication,
} from 'livekit-client';
import { useVoiceConnection } from './useVoiceConnection';
import { useVoice } from '../contexts/VoiceContext';

type AnyParticipant = RemoteParticipant | LocalParticipant;

export interface FloatTileSelection {
  kind: 'screen' | 'camera' | 'avatar';
  participant: AnyParticipant;
  publication?: TrackPublication;
}

/**
 * "Has a usable publication" — exists, not muted, AND subscribed (its track has
 * actually been attached). Camera/ScreenShare/ScreenShareAudio publications start
 * unsubscribed (see useTrackSubscription.ts) until watched, so checking existence +
 * !isMuted alone (the idiom used elsewhere for already-watched/gridded tiles) isn't
 * enough here: the float card can pick a participant whose camera was never opted
 * into via the full grid, and handing VideoTile an unsubscribed publication renders a
 * blank tile (publication.track is undefined) instead of falling back to the avatar.
 * `TrackPublication.isSubscribed` reflects the real subscription state for both
 * remote publications (false until setSubscribed(true) resolves a track) and local
 * ones (always true once published), so this works without a separate watch-state
 * parameter.
 */
function hasLivePublication(pub: TrackPublication | undefined | null): pub is TrackPublication {
  return !!pub && !pub.isMuted && pub.isSubscribed;
}

function findParticipant(room: Room, identity: string): AnyParticipant | undefined {
  if (room.localParticipant.identity === identity) return room.localParticipant;
  return room.remoteParticipants.get(identity);
}

function cameraOf(participant: AnyParticipant): TrackPublication | undefined {
  return participant.getTrackPublication(Track.Source.Camera);
}

function screenOf(participant: AnyParticipant): TrackPublication | undefined {
  return participant.getTrackPublication(Track.Source.ScreenShare);
}

/**
 * Pure selection logic for the float card's single tile. Priority:
 * 1. A watched screen share — prefer one belonging to an active speaker,
 *    else the first watched screen share with a live publication.
 * 2. The top active speaker's camera — else the next active speaker (in
 *    order) with a live camera — else the first remote/local participant
 *    with a live camera.
 * 3. Avatar fallback: the top active speaker, or the local participant if
 *    nobody is speaking.
 */
export function selectFloatTile(
  room: Room | null | undefined,
  watchingScreenShares: Set<string>,
  activeSpeakers: Participant[],
): FloatTileSelection | null {
  if (!room) return null;

  const speakerIds = new Set(activeSpeakers.map((s) => s.identity));

  // 1. Watched screen share
  const screenCandidates: { participant: AnyParticipant; publication: TrackPublication }[] = [];
  for (const identity of watchingScreenShares) {
    const participant = findParticipant(room, identity);
    if (!participant) continue;
    const publication = screenOf(participant);
    if (hasLivePublication(publication)) {
      screenCandidates.push({ participant, publication });
    }
  }
  if (screenCandidates.length > 0) {
    const speaking = screenCandidates.find((c) => speakerIds.has(c.participant.identity));
    const chosen = speaking ?? screenCandidates[0];
    return { kind: 'screen', participant: chosen.participant, publication: chosen.publication };
  }

  // 2. Active speaker's camera, else next active speaker with a camera, else
  // first remote/local participant with a camera.
  for (const speaker of activeSpeakers) {
    const participant = findParticipant(room, speaker.identity);
    if (!participant) continue;
    const publication = cameraOf(participant);
    if (hasLivePublication(publication)) {
      return { kind: 'camera', participant, publication };
    }
  }
  for (const participant of [...room.remoteParticipants.values(), room.localParticipant]) {
    const publication = cameraOf(participant);
    if (hasLivePublication(publication)) {
      return { kind: 'camera', participant, publication };
    }
  }

  // 3. Avatar fallback
  const topSpeaker = activeSpeakers[0];
  const avatarParticipant = topSpeaker ? findParticipant(room, topSpeaker.identity) : undefined;
  return { kind: 'avatar', participant: avatarParticipant ?? room.localParticipant };
}

/**
 * Thin hook wrapping `selectFloatTile`: keeps a locally-owned `activeSpeakers`
 * list fresh from the room and forces recomputation on track/participant
 * changes (mirrors VideoTiles' `trackUpdate` counter pattern).
 *
 * Anti-flap: the top active speaker is only accepted (and the selection
 * re-evaluated) when it changes to someone other than the local user — a
 * user who unmutes and briefly talks doesn't yank the float card onto their
 * own tile.
 */
export function useFloatTileSelection(): FloatTileSelection | null {
  const { state } = useVoiceConnection();
  const { watchingScreenShares } = useVoice();
  const room = state.room;

  const [activeSpeakers, setActiveSpeakers] = useState<Participant[]>([]);
  const [trackUpdate, setTrackUpdate] = useState(0);
  const lastTopSpeakerIdRef = useRef<string | null>(null);

  useEffect(() => {
    lastTopSpeakerIdRef.current = null;
    setActiveSpeakers([]);
    if (!room) return;

    const handleActiveSpeakersChanged = (speakers: Participant[]) => {
      const top = speakers[0];
      const topId = top?.identity ?? null;
      if (topId === lastTopSpeakerIdRef.current) return;
      if (top && top === room.localParticipant) return;
      lastTopSpeakerIdRef.current = topId;
      setActiveSpeakers(speakers);
    };

    const handleTrackChange = () => setTrackUpdate((prev) => prev + 1);

    room.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged);
    room.on(RoomEvent.TrackSubscribed, handleTrackChange);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackChange);
    room.on(RoomEvent.TrackMuted, handleTrackChange);
    room.on(RoomEvent.TrackUnmuted, handleTrackChange);
    room.on(RoomEvent.LocalTrackPublished, handleTrackChange);
    room.on(RoomEvent.LocalTrackUnpublished, handleTrackChange);
    room.on(RoomEvent.ParticipantConnected, handleTrackChange);
    room.on(RoomEvent.ParticipantDisconnected, handleTrackChange);

    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged);
      room.off(RoomEvent.TrackSubscribed, handleTrackChange);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackChange);
      room.off(RoomEvent.TrackMuted, handleTrackChange);
      room.off(RoomEvent.TrackUnmuted, handleTrackChange);
      room.off(RoomEvent.LocalTrackPublished, handleTrackChange);
      room.off(RoomEvent.LocalTrackUnpublished, handleTrackChange);
      room.off(RoomEvent.ParticipantConnected, handleTrackChange);
      room.off(RoomEvent.ParticipantDisconnected, handleTrackChange);
    };
  }, [room]);

  return useMemo(
    () => selectFloatTile(room, watchingScreenShares, activeSpeakers),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trackUpdate forces recomputation on subscription/participant changes
    [room, watchingScreenShares, activeSpeakers, trackUpdate],
  );
}
