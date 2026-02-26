import { useRef, useCallback, useEffect } from 'react';
import { ClientEvents } from '@kraken/shared';
import { useSocket } from './useSocket';

interface UseTypingEmitterOptions {
  channelId?: string;
  directMessageGroupId?: string;
}

const TYPING_DEBOUNCE_MS = 3_000;
const TYPING_IDLE_MS = 5_000;

/**
 * Emits typing start/stop events. Call `handleKeyPress` on input change
 * and `sendTypingStop` on message send.
 */
export function useTypingEmitter({ channelId, directMessageGroupId }: UseTypingEmitterOptions) {
  const socket = useSocket();
  const lastEmitRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const roomType = channelId
    ? 'channel'
    : directMessageGroupId
      ? 'dm'
      : null;
  const roomId = channelId ?? directMessageGroupId ?? null;

  const emitTypingEvent = useCallback(
    (event: ClientEvents.TYPING_START | ClientEvents.TYPING_STOP) => {
      if (!socket || !roomType || !roomId) return;

      const payload =
        roomType === 'channel'
          ? { channelId: roomId }
          : { directMessageGroupId: roomId };

      socket.emit(event, payload);
    },
    [socket, roomType, roomId],
  );

  const sendStart = useCallback(() => {
    emitTypingEvent(ClientEvents.TYPING_START);
    isTypingRef.current = true;
    lastEmitRef.current = Date.now();
  }, [emitTypingEvent]);

  const sendStop = useCallback(() => {
    if (!isTypingRef.current) return;
    emitTypingEvent(ClientEvents.TYPING_STOP);
    isTypingRef.current = false;
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, [emitTypingEvent]);

  const handleKeyPress = useCallback(() => {
    const now = Date.now();

    // Debounce: don't re-emit if we sent within TYPING_DEBOUNCE_MS
    if (now - lastEmitRef.current > TYPING_DEBOUNCE_MS) {
      sendStart();
    }

    // Reset idle timer
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      sendStop();
    }, TYPING_IDLE_MS);
  }, [sendStart, sendStop]);

  // Cleanup on unmount or context change
  useEffect(() => {
    return () => {
      if (isTypingRef.current) {
        emitTypingEvent(ClientEvents.TYPING_STOP);
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, [emitTypingEvent]);

  return { handleKeyPress, sendTypingStop: sendStop };
}
