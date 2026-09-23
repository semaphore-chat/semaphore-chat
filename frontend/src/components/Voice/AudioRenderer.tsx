import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { RemoteParticipant, RemoteTrackPublication, AudioTrack } from 'livekit-client';
import { useRoom } from '../../hooks/useRoom';
import { useVoice } from '../../contexts/VoiceContext';
import { audioBoostManager, boostKey } from '../../features/voice/audioBoostManager';
import { isBoostableAudioTrack } from '../../features/voice/isBoostableAudioTrack';
import { getStoredVolumePercent } from '../../features/voice/volumeStorage';
import { SOUNDBOARD_TRACK_NAME } from '../../features/voice/soundboardPlayer';
import { ROOM_EVENT, TRACK_SOURCE } from '../../features/voice/livekitEvents';
import { logger } from '../../utils/logger';

/**
 * Renders a hidden audio element for a single remote participant's audio track.
 * Handles track attachment/detachment lifecycle.
 */
interface ParticipantAudioProps {
  participant: RemoteParticipant;
  audioPublication: RemoteTrackPublication;
}

const ParticipantAudio: React.FC<ParticipantAudioProps> = ({ participant, audioPublication }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) {
      logger.warn('[AudioRenderer] No audio element ref for participant:', participant.identity);
      return;
    }

    const track = audioPublication.track as AudioTrack | undefined;
    if (!track) {
      logger.warn('[AudioRenderer] No track for publication:', audioPublication.trackSid);
      return;
    }

    // Attach the audio track to the audio element
    logger.info('[AudioRenderer] Attaching audio track for:', participant.identity, 'trackSid:', audioPublication.trackSid);
    track.attach(audioElement);

    // Re-apply the stored per-user volume AFTER attach. useRemoteVolumeEffect
    // applies it on TrackSubscribed, which fires before this element exists —
    // and RemoteAudioTrack.attach() only re-applies a previously set volume
    // when it is truthy ("if (this.elementVolume)"), so a stored volume of 0
    // (muted stream) never reaches the element and it plays at full volume.
    // applyVolume is idempotent and internally respects the deafened state.
    if (isBoostableAudioTrack(track)) {
      const volumePercent =
        getStoredVolumePercent(participant.identity, audioPublication.source) ?? 100;
      audioBoostManager.applyVolume(
        track,
        boostKey(participant.identity, audioPublication.source),
        volumePercent,
      );
    }

    return () => {
      // Detach the audio track when unmounting or track changes
      logger.info('[AudioRenderer] Detaching audio track for:', participant.identity);
      track.detach(audioElement);
    };
  }, [audioPublication, audioPublication.track, audioPublication.source, participant.identity]);

  return (
    <audio
      ref={audioRef}
      autoPlay
      playsInline
      // Not muted - we want to hear remote audio
      // Volume control: the stored per-user volume is applied right after
      // track.attach() above (so falsy 0 survives attach), and live changes
      // are owned by useRemoteVolumeEffect/useDeafenEffect via applyVolume.
    />
  );
};

/**
 * AudioRenderer component that renders hidden audio elements for all remote participants.
 *
 * This component is necessary because the app uses manual LiveKit Room management
 * (via RoomContext) instead of the LiveKitRoom provider. Without this component,
 * remote audio tracks are never attached to audio elements for playback.
 *
 * The deafen functionality is handled by the useDeafenEffect hook which sets
 * track volume to 0 when deafened.
 *
 * IMPORTANT: This component uses a ref for watchingScreenShares to keep the
 * updateAudioTracks callback and its event listener registrations stable.
 * Mic audio management must never be disrupted by screen share watching state changes.
 *
 * @example
 * // In Layout.tsx or MobileLayout.tsx, alongside VoiceBottomBar
 * <VoiceBottomBar />
 * <AudioRenderer />
 */
export const AudioRenderer: React.FC = () => {
  const { room } = useRoom();
  const { watchingScreenShares } = useVoice();
  const [audioTracks, setAudioTracks] = useState<Map<string, { participant: RemoteParticipant; publication: RemoteTrackPublication }>>(new Map());

  // Use a ref for watchingScreenShares so updateAudioTracks callback stays stable.
  // This prevents event listener teardown/re-registration when watching state changes,
  // which could cause missed events and audio drops.
  const watchingScreenSharesRef = useRef(watchingScreenShares);
  useEffect(() => {
    watchingScreenSharesRef.current = watchingScreenShares;
  }, [watchingScreenShares]);

  // Update audio tracks list when participants/tracks change
  const updateAudioTracks = useCallback(() => {
    if (!room) {
      logger.debug('[AudioRenderer] No room, clearing audio tracks');
      setAudioTracks(new Map());
      return;
    }

    const newTracks = new Map<string, { participant: RemoteParticipant; publication: RemoteTrackPublication }>();
    const currentWatching = watchingScreenSharesRef.current;

    logger.debug('[AudioRenderer] Updating audio tracks, remote participants:', room.remoteParticipants.size);
    room.remoteParticipants.forEach((participant) => {
      participant.audioTrackPublications.forEach((publication) => {
        // Include microphone tracks always; screen share audio only when watching that participant's screen share
        const isMic = publication.source === TRACK_SOURCE.Microphone;
        const isScreenShareAudio = publication.source === TRACK_SOURCE.ScreenShareAudio && currentWatching.has(participant.identity);
        // Soundboard tracks are Source.Unknown, identified by name — always audible.
        const isSoundboard = publication.trackName === SOUNDBOARD_TRACK_NAME;
        if ((isMic || isScreenShareAudio || isSoundboard) && publication.track) {
          const key = `${participant.identity}-${publication.trackSid}`;
          newTracks.set(key, { participant, publication });
          logger.debug('[AudioRenderer] Found audio track for:', participant.identity);
        }
      });
    });

    logger.info('[AudioRenderer] Audio tracks updated, count:', newTracks.size);
    setAudioTracks(newTracks);
  }, [room]);

  // Register room event listeners — stable because updateAudioTracks only depends on room
  useEffect(() => {
    if (!room) return;

    // Initial update
    updateAudioTracks();

    // Subscribe to relevant room events
    const events = [
      ROOM_EVENT.TrackSubscribed,
      ROOM_EVENT.TrackUnsubscribed,
      ROOM_EVENT.ParticipantConnected,
      ROOM_EVENT.ParticipantDisconnected,
    ] as const;

    events.forEach((event) => room.on(event, updateAudioTracks));

    return () => {
      events.forEach((event) => room.off(event, updateAudioTracks));
    };
  }, [room, updateAudioTracks]);

  // When watchingScreenShares changes, rebuild audio tracks to pick up
  // screen share audio subscriptions without re-registering event listeners.
  useEffect(() => {
    updateAudioTracks();
  }, [watchingScreenShares, updateAudioTracks]);

  // Don't render anything visible - just hidden audio elements
  if (!room || audioTracks.size === 0) {
    return null;
  }

  return (
    <>
      {Array.from(audioTracks.entries()).map(([key, { participant, publication }]) => (
        <ParticipantAudio
          key={key}
          participant={participant}
          audioPublication={publication}
        />
      ))}
    </>
  );
};
