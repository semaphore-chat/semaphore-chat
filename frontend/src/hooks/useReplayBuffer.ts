/**
 * useReplayBuffer Hook
 *
 * Automatically manages LiveKit egress recording when screen sharing.
 * Uses LiveKit event listeners to detect when screen share starts/stops.
 *
 * When user publishes screen share track:
 * - Extracts track IDs (video + audio)
 * - Calls backend to start egress recording
 *
 * When screen share track is unpublished:
 * - Calls backend to stop egress recording
 */

import { useEffect, useState, useRef } from 'react';
import { logger } from '../utils/logger';
import { Track, LocalTrackPublication, RoomEvent } from 'livekit-client';
import { useMutation } from '@tanstack/react-query';
import {
  livekitControllerStartReplayBufferMutation,
  livekitControllerStopReplayBufferMutation,
} from '../api-client/@tanstack/react-query.gen';
import { ServerEvents } from '@kraken/shared';
import { useNotification } from '../contexts/NotificationContext';
import { useServerEvent } from '../socket-hub/useServerEvent';
import { useVoiceConnection } from './useVoiceConnection';

export const useReplayBuffer = () => {
  const { state } = useVoiceConnection();
  const room = state.room;
  const { mutateAsync: startReplayBuffer } = useMutation(livekitControllerStartReplayBufferMutation());
  const { mutateAsync: stopReplayBuffer } = useMutation(livekitControllerStopReplayBufferMutation());
  const { showNotification } = useNotification();

  // Get current voice channel from voice connection state
  const currentVoiceChannel = state.currentChannelId;

  // Track whether replay buffer is active (using state for reactivity)
  const [isReplayBufferActive, setIsReplayBufferActive] = useState(false);

  // Use refs to prevent race conditions - these are always current, not stale closures
  const isOperationPendingRef = useRef(false);
  const isActiveRef = useRef(false);

  // Operation queuing: instead of dropping events when busy, queue them
  const pendingOperationRef = useRef<'start' | 'stop' | null>(null);
  const pendingStartDataRef = useRef<LocalTrackPublication | null>(null);

  // Keep ref in sync with state for external reactivity
  useEffect(() => {
    isActiveRef.current = isReplayBufferActive;
  }, [isReplayBufferActive]);

  // Listen for LiveKit track events to start/stop replay buffer
  useEffect(() => {
    if (!room || !currentVoiceChannel) return;

    const executeStart = async (publication: LocalTrackPublication) => {
      // Extract video track ID
      const videoTrackId = publication.track?.sid;

      if (!videoTrackId) {
        logger.warn('[ReplayBuffer] Screen share has no video track');
        return;
      }

      // Screen share audio is published as a separate track (Track.Source.ScreenShareAudio).
      // It may arrive slightly after the video track, so retry briefly.
      let audioTrackId: string | undefined;
      for (let attempt = 0; attempt < 10; attempt++) {
        const audioPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
        audioTrackId = audioPub?.track?.sid;
        if (audioTrackId) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      if (!audioTrackId) {
        logger.warn('[ReplayBuffer] No screen share audio track found — recording without audio');
      }

      // Get participant identity for track resolution query
      const participantIdentity = room.localParticipant?.identity;

      logger.dev('[ReplayBuffer] Screen share published, starting replay buffer', {
        channelId: currentVoiceChannel,
        roomName: room.name,
        videoTrackId,
        audioTrackId,
        participantIdentity,
      });

      isOperationPendingRef.current = true;

      try {
        await startReplayBuffer({
          body: {
            channelId: currentVoiceChannel,
            roomName: room.name,
            videoTrackId,
            ...(audioTrackId ? { audioTrackId } : {}),
            participantIdentity, // Pass identity for track resolution matching
          },
        });

        isActiveRef.current = true;
        setIsReplayBufferActive(true);
        showNotification('Replay available', 'success');
        logger.dev('[ReplayBuffer] Replay buffer started successfully');
      } catch (error) {
        logger.error('[ReplayBuffer] Failed to start replay buffer:', error);
        showNotification('Replay unavailable', 'error');
      } finally {
        isOperationPendingRef.current = false;
        processPendingOperation();
      }
    };

    const executeStop = async () => {
      logger.dev('[ReplayBuffer] Stopping replay buffer');

      isOperationPendingRef.current = true;

      try {
        await stopReplayBuffer({});
        isActiveRef.current = false;
        setIsReplayBufferActive(false);
        logger.dev('[ReplayBuffer] Replay buffer stopped successfully');
      } catch (error) {
        logger.error('[ReplayBuffer] Failed to stop replay buffer:', error);
      } finally {
        isOperationPendingRef.current = false;
        processPendingOperation();
      }
    };

    const processPendingOperation = () => {
      const pending = pendingOperationRef.current;
      if (!pending) return;

      pendingOperationRef.current = null;

      if (pending === 'start') {
        const publication = pendingStartDataRef.current;
        pendingStartDataRef.current = null;
        if (publication) {
          logger.dev('[ReplayBuffer] Processing queued start operation');
          executeStart(publication);
        }
      } else if (pending === 'stop') {
        if (isActiveRef.current) {
          logger.dev('[ReplayBuffer] Processing queued stop operation');
          executeStop();
        }
      }
    };

    const handleTrackPublished = async (publication: LocalTrackPublication) => {
      // Only handle screen share tracks
      if (publication.source !== Track.Source.ScreenShare) return;

      // Queue if an operation is in-flight
      if (isOperationPendingRef.current) {
        logger.dev('[ReplayBuffer] Operation pending, queuing start');
        pendingOperationRef.current = 'start';
        pendingStartDataRef.current = publication;
        return;
      }

      // The backend handles "start while active" by stopping the old session first,
      // so we don't need to guard on isActiveRef here.
      await executeStart(publication);
    };

    const handleTrackUnpublished = async (publication: LocalTrackPublication) => {
      // Only handle screen share tracks
      if (publication.source !== Track.Source.ScreenShare) return;

      // Queue if an operation is in-flight
      if (isOperationPendingRef.current) {
        logger.dev('[ReplayBuffer] Operation pending, queuing stop');
        pendingOperationRef.current = 'stop';
        return;
      }

      if (!isActiveRef.current) return;

      await executeStop();
    };

    // Attach event listeners to room (not localParticipant)
    room.on(RoomEvent.LocalTrackPublished, handleTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, handleTrackUnpublished);

    return () => {
      room.off(RoomEvent.LocalTrackPublished, handleTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, handleTrackUnpublished);
    };
  }, [
    room,
    currentVoiceChannel,
    startReplayBuffer,
    stopReplayBuffer,
    showNotification,
  ]);

  // Listen for WebSocket events when egress stops automatically (disconnect, track end, etc.)
  useServerEvent(ServerEvents.REPLAY_BUFFER_STOPPED, (data) => {
    logger.dev('[ReplayBuffer] Egress stopped by LiveKit:', data);
    showNotification('Replay ended', 'info');
    isActiveRef.current = false;
    setIsReplayBufferActive(false);
  });

  useServerEvent(ServerEvents.REPLAY_BUFFER_FAILED, (data) => {
    logger.error('[ReplayBuffer] Egress failed:', data);
    showNotification('Replay unavailable', 'error');
    isActiveRef.current = false;
    setIsReplayBufferActive(false);
  });

  // Cleanup: stop replay buffer when component unmounts if still active
  useEffect(() => {
    return () => {
      // Use refs to check current state on unmount (not stale closure)
      if (isActiveRef.current && !isOperationPendingRef.current) {
        logger.dev('[ReplayBuffer] Component unmounting, stopping replay buffer');
        stopReplayBuffer({}).catch((error) => {
          // Ignore 404 errors - session may already be stopped
          const errorObj = error as { status?: number };
          if (errorObj?.status !== 404) {
            logger.error('[ReplayBuffer] Failed to stop on unmount:', error);
          }
        });
      }
    };
  }, [stopReplayBuffer]);

  return {
    isReplayBufferActive,
  };
};
