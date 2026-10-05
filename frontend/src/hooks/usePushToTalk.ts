import { useEffect, useState, useCallback, useRef } from 'react';
import { useVoice, useVoiceDispatch } from '../contexts/VoiceContext';
import { useRoom } from './useRoom';
import { useVoiceSettings } from './useVoiceSettings';
import { logger } from '../utils/logger';

/**
 * Hook to handle Push to Talk functionality.
 *
 * When PTT mode is active and user is connected to voice,
 * this hook listens for the configured PTT key and controls
 * the microphone accordingly.
 *
 * @param options.canSpeak - false (no SPEAK in this channel, or timed out)
 *   ignores presses: the server would refuse the microphone anyway.
 * @returns Object with PTT state information
 */
export function usePushToTalk(options: { canSpeak?: boolean } = {}) {
  const canSpeak = options.canSpeak ?? true;
  const { getRoom } = useRoom();
  const voiceState = useVoice();
  const { stateRef } = useVoiceDispatch();
  const { inputMode, pushToTalkKey, pushToTalkKeyDisplay, isPushToTalk } = useVoiceSettings();

  const [isKeyHeld, setIsKeyHeld] = useState(false);
  const isKeyHeldRef = useRef(false);
  // Ref so the shared press handler always sees the current permission
  const canSpeakRef = useRef(canSpeak);
  useEffect(() => {
    canSpeakRef.current = canSpeak;
  }, [canSpeak]);

  // Track if PTT is active (connected to voice AND in PTT mode)
  const isActive = voiceState.isConnected && isPushToTalk;

  // Core "start transmitting" logic, shared by the keyboard handler and the
  // programmatic (touch hold-to-talk) path. Keeping a single implementation
  // means both routes honor the same guards — notably the server-mute check
  // read via stateRef (#380) so we always see the CURRENT value, never a
  // stale closure.
  const pttPress = useCallback(async () => {
    // Only meaningful while connected and in PTT mode, and ignore re-entrant
    // presses while already held (the keyboard path filters these via
    // event.repeat; programmatic callers get the same protection here).
    if (!isActive) return;
    if (isKeyHeldRef.current) return;

    if (!canSpeakRef.current) {
      logger.dev('[PTT] Press without SPEAK permission, ignoring');
      return;
    }

    const room = getRoom();
    if (!room) return;

    // Block transmit when server-muted — mirrors the guard in toggleMicrophone.
    if (stateRef.current.isServerMuted) {
      logger.dev('[PTT] Press while server muted, ignoring');
      return;
    }

    try {
      isKeyHeldRef.current = true;
      setIsKeyHeld(true);
      await room.localParticipant.setMicrophoneEnabled(true);
      logger.dev('[PTT] Pressed, microphone enabled');
    } catch (error) {
      logger.error('[PTT] Failed to enable microphone:', error);
    }
  }, [isActive, getRoom, stateRef]);

  // Core "stop transmitting" logic, shared by keyboard keyup, window blur, and
  // the programmatic (touch) release path.
  const pttRelease = useCallback(async () => {
    const room = getRoom();
    if (!room) return;

    try {
      isKeyHeldRef.current = false;
      setIsKeyHeld(false);
      await room.localParticipant.setMicrophoneEnabled(false);
      logger.dev('[PTT] Released, microphone disabled');
    } catch (error) {
      logger.error('[PTT] Failed to disable microphone:', error);
    }
  }, [getRoom]);

  // Handle keydown - enable microphone
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Check if this is our PTT key
    if (event.code !== pushToTalkKey) return;

    // Ignore if key is being held (repeat events)
    if (event.repeat) return;

    // Don't activate PTT if user is typing in an input field
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    event.preventDefault();
    void pttPress();
  }, [pushToTalkKey, pttPress]);

  // Handle keyup - disable microphone
  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    // Check if this is our PTT key
    if (event.code !== pushToTalkKey) return;
    void pttRelease();
  }, [pushToTalkKey, pttRelease]);

  // Handle window blur - release mic if user switches tabs while holding key
  const handleBlur = useCallback(() => {
    if (!isKeyHeldRef.current) return;
    void pttRelease();
  }, [pttRelease]);

  // Set up event listeners when PTT is active
  useEffect(() => {
    if (!isActive) {
      // Reset state when PTT becomes inactive
      if (isKeyHeldRef.current) {
        isKeyHeldRef.current = false;
        setIsKeyHeld(false);
      }
      return;
    }

    logger.dev('[PTT] Push to Talk activated, listening for key:', pushToTalkKey);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);

      // Ensure mic is disabled when hook unmounts while key is held
      if (isKeyHeldRef.current) {
        const room = getRoom();
        if (room) {
          room.localParticipant.setMicrophoneEnabled(false);
        }
      }
    };
  }, [isActive, pushToTalkKey, handleKeyDown, handleKeyUp, handleBlur, getRoom]);

  // Apply the correct mic state when the input mode changes mid-call (#381).
  //
  // PTT -> voice activity: in PTT mode the resting state of the mic
  // publication is always muted (keyup/blur mute it), and the mute state is
  // one-dimensional — there is no separate "user clicked mute" flag, so a
  // manual mute while in PTT mode is indistinguishable from the PTT-idle
  // mute. The pragmatic rule: unmute so voice activity transmits immediately
  // (that is what choosing VA means), unless the user is server-muted or
  // deafened — those states must never be overridden from here.
  //
  // Voice activity -> PTT: the resting state must be muted until the PTT key
  // is held. The activation effect above only attaches listeners and never
  // mutes, so handle it on the transition.
  const prevIsPushToTalkRef = useRef(isPushToTalk);
  useEffect(() => {
    const wasPushToTalk = prevIsPushToTalkRef.current;
    prevIsPushToTalkRef.current = isPushToTalk;

    if (wasPushToTalk === isPushToTalk) return;
    if (!voiceState.isConnected) return;

    const room = getRoom();
    if (!room) return;

    if (isPushToTalk) {
      // VA -> PTT: rest muted until the key is held
      room.localParticipant.setMicrophoneEnabled(false)
        .then(() => logger.dev('[PTT] Switched to push to talk, microphone muted until key held'))
        .catch((error) => logger.error('[PTT] Failed to mute microphone on mode switch:', error));
    } else if (!voiceState.isServerMuted && !voiceState.isDeafened) {
      // PTT -> VA: unmute so voice activity works (see comment above)
      room.localParticipant.setMicrophoneEnabled(true)
        .then(() => logger.dev('[PTT] Switched to voice activity, microphone enabled'))
        .catch((error) => logger.error('[PTT] Failed to enable microphone on mode switch:', error));
    }
  }, [isPushToTalk, voiceState.isConnected, voiceState.isServerMuted, voiceState.isDeafened, getRoom]);

  return {
    // Whether PTT mode is currently active (connected + PTT mode enabled)
    isActive,

    // Whether the PTT key is currently being held
    isKeyHeld,

    // The display name of the current PTT key
    currentKeyDisplay: pushToTalkKeyDisplay,

    // Current input mode
    inputMode,

    // Programmatic transmit controls, sharing the exact guards/state the
    // keyboard path uses. Used by touch "hold-to-talk" UI.
    pttPress,
    pttRelease,
  };
}
