import { useState, useEffect } from 'react';
import { useRoom } from './useRoom';
import { Track, RoomEvent } from 'livekit-client';
import type { Participant, RemoteParticipant } from 'livekit-client';

export interface ParticipantMediaState {
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  isScreenShareEnabled: boolean;
  isSpeaking: boolean;
  isDeafened: boolean;
  participant: Participant | null;
}

/**
 * Hook to read media state for any participant (local or remote) from LiveKit
 *
 * Returns the participant's camera, microphone, screen share, and speaking state
 * by observing LiveKit track publications and events.
 *
 * @param participantIdentity - The participant's identity (typically user ID)
 * @returns Media state for the participant
 *
 * @example
 * const { isCameraEnabled, isMicrophoneEnabled, isSpeaking } = useParticipantTracks(userId);
 *
 * // Show video tile only if camera is enabled
 * {isCameraEnabled && <VideoTile participant={userId} />}
 */
export const useParticipantTracks = (
  participantIdentity: string | undefined
): ParticipantMediaState => {
  const { room } = useRoom();
  const [mediaState, setMediaState] = useState<ParticipantMediaState>({
    isCameraEnabled: false,
    isMicrophoneEnabled: false,
    isScreenShareEnabled: false,
    isSpeaking: false,
    isDeafened: false,
    participant: null,
  });

  useEffect(() => {
    if (!room || !participantIdentity) {
      // Reset state when no room or no identity
      setMediaState({
        isCameraEnabled: false,
        isMicrophoneEnabled: false,
        isScreenShareEnabled: false,
        isSpeaking: false,
        isDeafened: false,
        participant: null,
      });
      return;
    }

    // Find the participant (local or remote)
    let participant: Participant | null = null;
    const isLocal = room.localParticipant.identity === participantIdentity;
    if (isLocal) {
      participant = room.localParticipant;
    } else {
      participant = room.remoteParticipants.get(participantIdentity) || null;
    }

    if (!participant) {
      // Participant not in room yet, reset state
      setMediaState({
        isCameraEnabled: false,
        isMicrophoneEnabled: false,
        isScreenShareEnabled: false,
        isSpeaking: false,
        isDeafened: false,
        participant: null,
      });
      return;
    }

    // Function to update media state from participant's publications
    const updateMediaState = () => {
      if (!participant) return;

      const cameraPublication = participant.getTrackPublication(Track.Source.Camera);
      const isCameraEnabled = !!cameraPublication && !cameraPublication.isMuted;

      const micPublication = participant.getTrackPublication(Track.Source.Microphone);
      const isMicrophoneEnabled = !!micPublication && !micPublication.isMuted;

      const screenSharePublication = participant.getTrackPublication(Track.Source.ScreenShare);
      const isScreenShareEnabled = !!screenSharePublication && !screenSharePublication.isMuted;

      let isDeafened = false;
      if (participant.metadata) {
        try {
          const meta = JSON.parse(participant.metadata) as { isDeafened?: boolean };
          isDeafened = meta.isDeafened ?? false;
        } catch {
          // Invalid metadata JSON
        }
      }

      setMediaState({
        isCameraEnabled,
        isMicrophoneEnabled,
        isScreenShareEnabled,
        isSpeaking: participant.isSpeaking,
        isDeafened,
        participant,
      });
    };

    // Initialize state
    updateMediaState();

    // Event handlers for track changes
    const handleTrackPublished = () => {
      updateMediaState();
    };

    const handleTrackUnpublished = () => {
      updateMediaState();
    };

    const handleTrackMuted = () => {
      updateMediaState();
    };

    const handleTrackUnmuted = () => {
      updateMediaState();
    };

    const handleIsSpeakingChanged = (speaking: boolean) => {
      setMediaState((prev) => ({ ...prev, isSpeaking: speaking }));
    };

    const handleMetadataChanged = () => {
      updateMediaState();
    };

    // Attach event listeners to participant
    // LocalParticipant fires 'localTrackPublished'/'localTrackUnpublished'
    // RemoteParticipant fires 'trackPublished'/'trackUnpublished'
    // trackMuted/trackUnmuted work for both local and remote
    const publishEvent = isLocal ? 'localTrackPublished' : 'trackPublished';
    const unpublishEvent = isLocal ? 'localTrackUnpublished' : 'trackUnpublished';
    participant.on(publishEvent, handleTrackPublished);
    participant.on(unpublishEvent, handleTrackUnpublished);
    participant.on('trackMuted', handleTrackMuted);
    participant.on('trackUnmuted', handleTrackUnmuted);
    participant.on('isSpeakingChanged', handleIsSpeakingChanged);
    participant.on('participantMetadataChanged', handleMetadataChanged);

    // Handle participant disconnect
    const handleParticipantDisconnected = (p: RemoteParticipant) => {
      if (p.identity === participantIdentity) {
        setMediaState({
          isCameraEnabled: false,
          isMicrophoneEnabled: false,
          isScreenShareEnabled: false,
          isSpeaking: false,
          isDeafened: false,
          participant: null,
        });
      }
    };

    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);

    // Cleanup function
    return () => {
      if (participant) {
        participant.off(publishEvent, handleTrackPublished);
        participant.off(unpublishEvent, handleTrackUnpublished);
        participant.off('trackMuted', handleTrackMuted);
        participant.off('trackUnmuted', handleTrackUnmuted);
        participant.off('isSpeakingChanged', handleIsSpeakingChanged);
        participant.off('participantMetadataChanged', handleMetadataChanged);
      }
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    };
  }, [room, participantIdentity]);

  return mediaState;
};
