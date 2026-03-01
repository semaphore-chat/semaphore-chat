import { useRef } from 'react';
import { ServerEvents } from '@kraken/shared';
import { useServerEvent } from '../socket-hub/useServerEvent';
import { useVoiceDispatch } from '../contexts/VoiceContext';
import { useRoom } from './useRoom';
import { useCurrentUser } from './useCurrentUser';
import { logger } from '../utils/logger';
import { playSound, Sounds } from './useSound';

/**
 * Hook that listens for VOICE_CHANNEL_USER_UPDATED events and enforces
 * server mute state on the local user.
 *
 * When the local user is server-muted:
 * - Dispatches SET_SERVER_MUTED to VoiceContext
 * - Forces mic off via LiveKit
 *
 * When the local user is server-unmuted:
 * - Dispatches SET_SERVER_MUTED(false) to VoiceContext
 * - Does NOT re-enable mic (user must unmute themselves)
 */
export const useServerMuteEffect = () => {
  const { dispatch } = useVoiceDispatch();
  const { room } = useRoom();
  const { user } = useCurrentUser();
  const wasServerMutedRef = useRef(false);

  useServerEvent(ServerEvents.VOICE_CHANNEL_USER_UPDATED, (payload) => {
    if (!user || payload.userId !== user.id) return;

    const isServerMuted = payload.user.isServerMuted ?? false;

    dispatch({ type: 'SET_SERVER_MUTED', payload: isServerMuted });

    // Only play error sound on the unmuted → muted transition
    if (isServerMuted && !wasServerMutedRef.current) {
      playSound(Sounds.error);
    }
    wasServerMutedRef.current = isServerMuted;

    if (isServerMuted && room) {
      room.localParticipant.setMicrophoneEnabled(false).catch((err) => {
        logger.warn('[Voice] Failed to force mic off for server mute:', err);
      });
    }

    logger.info('[Voice] Server mute state updated:', isServerMuted);
  });
};
