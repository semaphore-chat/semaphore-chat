/**
 * useScreenShare Hook
 *
 * Platform-aware screen sharing hook that handles differences between
 * Electron and web browser implementations.
 *
 * - In Electron: Shows custom source picker with advanced settings
 * - In Web: Uses native browser getDisplayMedia picker
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useVoiceConnection } from './useVoiceConnection';
import { useLocalMediaState } from './useLocalMediaState';
import { hasElectronFeature, isWayland } from '../utils/platform';
import { ScreenShareSettings } from '../components/Voice/ScreenSourcePicker';
import { setScreenShareConfig, clearScreenShareConfig } from '../utils/screenShareState';
import { useNotification } from '../contexts/NotificationContext';
import { useVoice } from '../contexts/VoiceContext';
import { playSound, Sounds } from './useSound';

interface UseScreenShareReturn {
  isScreenSharing: boolean;
  showSourcePicker: boolean;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  handleSourceSelect: (sourceId: string, settings: ScreenShareSettings) => Promise<void>;
  handleSourcePickerClose: () => void;
}

/**
 * Hook for platform-aware screen sharing
 */
export const useScreenShare = (): UseScreenShareReturn => {
  const { actions } = useVoiceConnection();
  const { isScreenShareEnabled } = useLocalMediaState();
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const { showNotification } = useNotification();

  // Track if audio capture failed (USB headset in exclusive mode, etc.)
  const { screenShareAudioFailed } = useVoice();
  const prevAudioFailedRef = useRef(false);

  // Show notification when audio capture fails
  useEffect(() => {
    if (screenShareAudioFailed && !prevAudioFailedRef.current) {
      playSound(Sounds.error);
      showNotification(
        'Screen audio capture failed. This may be due to your audio device settings. Sharing screen without audio.',
        'warning'
      );
    }
    prevAudioFailedRef.current = screenShareAudioFailed;
  }, [screenShareAudioFailed, showNotification]);

  /**
   * Start screen sharing
   * - Electron: Shows source picker dialog first
   * - Web: Directly triggers native browser picker via LiveKit
   */
  const startScreenShare = useCallback(async () => {
    if (hasElectronFeature('getDesktopSources') && !isWayland()) {
      // Electron on X11/macOS/Windows: Show custom source picker
      setShowSourcePicker(true);
    } else {
      // Web or Electron on Wayland: Let browser/OS handle source selection.
      // On Wayland, the main process handler triggers the PipeWire portal.
      await actions.toggleScreenShare();
    }
  }, [actions]);

  /**
   * Stop screen sharing (platform-agnostic)
   */
  const stopScreenShare = useCallback(async () => {
    await actions.toggleScreenShare();
  }, [actions]);

  /**
   * Toggle screen sharing
   * - If currently sharing: stop immediately
   * - If not sharing: start (shows picker on Electron, native on web)
   */
  const toggleScreenShare = useCallback(async () => {
    if (isScreenShareEnabled) {
      await stopScreenShare();
    } else {
      await startScreenShare();
    }
  }, [isScreenShareEnabled, startScreenShare, stopScreenShare]);

  /**
   * Handle source selection from Electron picker
   * Stores selection for Electron main process to access via setDisplayMediaRequestHandler
   */
  const handleSourceSelect = useCallback(
    async (sourceId: string, settings: ScreenShareSettings) => {
      setShowSourcePicker(false);

      // Store selected source and settings for Electron main process using type-safe interface
      setScreenShareConfig(sourceId, settings);

      // Start screen share (LiveKit will use selected source via main.ts handler)
      await actions.toggleScreenShare();
    },
    [actions]
  );

  /**
   * Handle source picker dialog close
   */
  const handleSourcePickerClose = useCallback(() => {
    setShowSourcePicker(false);
  }, []);

  /**
   * Clean up screen share config when screen sharing stops
   */
  useEffect(() => {
    if (!isScreenShareEnabled) {
      clearScreenShareConfig();
    }
  }, [isScreenShareEnabled]);

  return {
    isScreenSharing: isScreenShareEnabled,
    showSourcePicker,
    startScreenShare,
    stopScreenShare,
    toggleScreenShare,
    handleSourceSelect,
    handleSourcePickerClose,
  };
};
