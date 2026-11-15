/**
 * What a screen share does to the call, whatever is on screen (design F6):
 *
 * - a share whose audio capture failed (USB headset in exclusive mode, ...)
 *   says so once, with the error sound;
 * - your own share starting opens the video panel, so you see what you
 *   broadcast (remote viewers get the same from useTrackSubscription's
 *   TrackPublished handler);
 * - the Electron source selection is cleared when sharing stops.
 *
 * Mounted once per call by VoiceSessionEffects. These used to run inside
 * useScreenShare, i.e. only while the classic voice bar was mounted; the
 * picker and the share controls stay in useScreenShare.
 */
import { useEffect, useRef } from 'react';
import { useVoiceConnection } from './useVoiceConnection';
import { useLocalMediaState } from './useLocalMediaState';
import { clearScreenShareConfig } from '../utils/screenShareState';
import { useOptionalNotification } from '../contexts/NotificationContext';
import { playSound, Sounds } from './useSound';

export const SCREEN_SHARE_AUDIO_FAILED_MESSAGE =
  'Screen audio capture failed. This may be due to your audio device settings. Sharing screen without audio.';

export function useScreenShareSession(): void {
  const { state, actions } = useVoiceConnection();
  const { isScreenShareEnabled } = useLocalMediaState();
  const showNotification = useOptionalNotification()?.showNotification;

  // Show a notification when audio capture fails
  const screenShareAudioFailed = !!state.screenShareAudioFailed;
  const prevAudioFailedRef = useRef(false);
  useEffect(() => {
    if (screenShareAudioFailed && !prevAudioFailedRef.current) {
      playSound(Sounds.error);
      showNotification?.(SCREEN_SHARE_AUDIO_FAILED_MESSAGE, 'warning');
    }
    prevAudioFailedRef.current = screenShareAudioFailed;
  }, [screenShareAudioFailed, showNotification]);

  // Clean up the screen share config when sharing stops
  useEffect(() => {
    if (!isScreenShareEnabled) {
      clearScreenShareConfig();
    }
  }, [isScreenShareEnabled]);

  // Open the video panel when our own screen share starts
  const { revealVideoTiles } = actions;
  const prevScreenShareEnabledRef = useRef(isScreenShareEnabled);
  useEffect(() => {
    if (isScreenShareEnabled && !prevScreenShareEnabledRef.current) {
      revealVideoTiles();
    }
    prevScreenShareEnabledRef.current = isScreenShareEnabled;
  }, [isScreenShareEnabled, revealVideoTiles]);
}
