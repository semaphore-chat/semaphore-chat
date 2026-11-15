/**
 * The video of the call you are in, as the new shell's call surface shows it: each remote screen share and
 * camera that is published (shares first, then cameras), whether you watch it, and its track once it is
 * subscribed. (Your own share is the call bar model's `sharingScreen`.)
 *
 * Watching stays opt-in, exactly as in the classic app (`useTrackSubscription`): a published share or camera
 * is not received until the user watches it, and nothing here watches anything by itself. `watch` and
 * `stopWatching` are the classic watch/stop-watching functions (`TrackSubscriptionContext`, the ones the
 * classic stage tiles call), so both shells see the same watch state.
 *
 * Headless and free of livekit-client values (the room's event names and track sources are the string
 * mirrors in features/voice/livekitEvents), so the call slot can tell whether the lazy surface is needed
 * without loading LiveKit. The listener on the room is this piece's own, for its life, like
 * `useFloatTileSelection`'s: it changes nothing about the call.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Participant, RemoteParticipant, TrackPublication } from 'livekit-client';
import { useVoiceConnection } from '../hooks/useVoiceConnection';
import { useSpeaking } from '../hooks/useSpeaking';
import { ROOM_EVENT, TRACK_SOURCE } from '../features/voice/livekitEvents';

/** The part of a LiveKit video track the surface uses: show it in a `<video>`, and stop. */
export interface CallVideoTrack {
  attach(element: HTMLMediaElement): HTMLMediaElement;
  detach(element: HTMLMediaElement): HTMLMediaElement;
}

export interface CallVideoTile {
  /** Stable per participant and kind ("dropbear:screen"). */
  id: string;
  identity: string;
  /** Display name of who shares it. */
  name: string;
  kind: 'screen' | 'camera';
  /** You chose to watch it (the classic watch state). */
  watched: boolean;
  /** The subscribed, unmuted track: there is a picture to show. Null until the subscription lands. */
  track: CallVideoTrack | null;
  speaking: boolean;
}

export interface CallVideo {
  /** Remote shares first, then remote cameras, in the room's participant order. */
  tiles: CallVideoTile[];
  /** Start watching one tile (subscribes it), as the classic "Click to watch" tile does. */
  watch(tile: Pick<CallVideoTile, 'identity' | 'kind'>): void;
  /** Stop watching each watched tile shown (unsubscribes them), as the classic stage tile's stop button does. */
  stopWatching(): void;
}

/** The events that change which tiles exist or what they show. */
const ROOM_EVENTS = [
  ROOM_EVENT.TrackPublished,
  ROOM_EVENT.TrackUnpublished,
  ROOM_EVENT.TrackSubscribed,
  ROOM_EVENT.TrackUnsubscribed,
  ROOM_EVENT.TrackMuted,
  ROOM_EVENT.TrackUnmuted,
  ROOM_EVENT.ParticipantConnected,
  ROOM_EVENT.ParticipantDisconnected,
  ROOM_EVENT.LocalTrackPublished,
  ROOM_EVENT.LocalTrackUnpublished,
] as const;

function publication(participant: Participant, source: string): TrackPublication | undefined {
  for (const [, pub] of participant.trackPublications) {
    if (pub.source === source) return pub;
  }
  return undefined;
}

function liveTrack(pub: TrackPublication): CallVideoTrack | null {
  if (pub.isMuted || !pub.isSubscribed || !pub.track) return null;
  return pub.track;
}

/** Pure: the tiles of a room (exported for tests). */
export function callVideoTiles(
  participants: Iterable<RemoteParticipant>,
  watching: { cameras: ReadonlySet<string>; screens: ReadonlySet<string> },
  speaking: (identity: string) => boolean,
): CallVideoTile[] {
  const screens: CallVideoTile[] = [];
  const cameras: CallVideoTile[] = [];
  for (const participant of participants) {
    const name = participant.name || participant.identity;
    const screen = publication(participant, TRACK_SOURCE.ScreenShare);
    if (screen) {
      screens.push({
        id: `${participant.identity}:screen`,
        identity: participant.identity,
        name,
        kind: 'screen',
        watched: watching.screens.has(participant.identity),
        track: liveTrack(screen),
        speaking: speaking(participant.identity),
      });
    }
    const camera = publication(participant, TRACK_SOURCE.Camera);
    // A camera that is turned off (muted) is no picture to offer.
    if (camera && !camera.isMuted) {
      cameras.push({
        id: `${participant.identity}:camera`,
        identity: participant.identity,
        name,
        kind: 'camera',
        watched: watching.cameras.has(participant.identity),
        track: liveTrack(camera),
        speaking: speaking(participant.identity),
      });
    }
  }
  return [...screens, ...cameras];
}

/** Null when not in a connected call. */
export function useCallVideo(): CallVideo | null {
  const { state, actions } = useVoiceConnection();
  const { speakingMap } = useSpeaking();
  const room = state.isConnected ? state.room : null;

  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!room) return;
    const bump = () => setVersion((v) => v + 1);
    for (const event of ROOM_EVENTS) room.on(event, bump);
    return () => {
      for (const event of ROOM_EVENTS) room.off(event, bump);
    };
  }, [room]);

  const { watchingCameras, watchingScreenShares } = state;
  const tiles = useMemo(
    () =>
      room
        ? callVideoTiles(
            room.remoteParticipants.values(),
            { cameras: watchingCameras, screens: watchingScreenShares },
            (identity) => speakingMap.get(identity) === true,
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version: the room changed in place (its events)
    [room, watchingCameras, watchingScreenShares, speakingMap, version],
  );

  const { watchScreenShare, watchCamera, stopWatchingScreenShare, stopWatchingCamera } = actions;
  const watch = useCallback(
    (tile: Pick<CallVideoTile, 'identity' | 'kind'>) => {
      if (tile.kind === 'screen') watchScreenShare?.(tile.identity);
      else watchCamera?.(tile.identity);
    },
    [watchScreenShare, watchCamera],
  );
  const stopWatching = useCallback(() => {
    for (const tile of tiles) {
      if (!tile.watched) continue;
      if (tile.kind === 'screen') stopWatchingScreenShare?.(tile.identity);
      else stopWatchingCamera?.(tile.identity);
    }
  }, [tiles, stopWatchingScreenShare, stopWatchingCamera]);

  return useMemo(() => (room ? { tiles, watch, stopWatching } : null), [room, tiles, watch, stopWatching]);
}
