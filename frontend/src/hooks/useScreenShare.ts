/**
 * useScreenShare Hook
 *
 * Platform-aware screen sharing hook that handles differences between
 * Electron and web browser implementations.
 *
 * - In Electron: Shows custom source picker with advanced settings
 * - In Web: Uses native browser getDisplayMedia picker
 *
 * Only the controls and the picker. What a share does to the call (the
 * audio-failed notice, opening the video panel on your own share, clearing
 * the Electron selection) runs in useScreenShareSession, mounted once per
 * call by VoiceSessionEffects.
 */

import { useState, useCallback } from 'react';
import { useVoiceConnection } from './useVoiceConnection';
import { useLocalMediaState } from './useLocalMediaState';
import { hasElectronFeature, isWayland } from '../utils/platform';
import type { ScreenShareSettings } from '../components/Voice/ScreenSourcePicker';
import { setScreenShareConfig, clearScreenShareConfig } from '../utils/screenShareState';
import { logger } from '../utils/logger';

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
      try {
        await actions.toggleScreenShare();
      } catch (error) {
        // Picker cancelled, or the capture refused: sharing just stays off
        // (toggleScreenShareUnified has already logged the error).
        logger.warn('[ScreenShare] screen share not started:', error);
      }
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
      try {
        await actions.toggleScreenShare();
      } catch (error) {
        // Main refused the capture (e.g. the picked window closed meanwhile,
        // so it's no longer among the sources): sharing stays off. Drop the
        // selection so a later request can't pick it up.
        clearScreenShareConfig();
        logger.warn('[ScreenShare] screen share not started:', error);
      }
    },
    [actions]
  );

  /**
   * Handle source picker dialog close
   */
  const handleSourcePickerClose = useCallback(() => {
    setShowSourcePicker(false);
  }, []);

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
