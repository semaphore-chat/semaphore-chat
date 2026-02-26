/**
 * Electron screen capture utilities
 *
 * This module handles screen sharing in Electron by using the desktopCapturer API
 * instead of the standard browser getDisplayMedia API.
 */

import { logger } from './logger';
import { isElectron } from './platform';
import type { DesktopSource } from '../types/electron-api';

/**
 * Get available desktop sources for screen capture
 */
export async function getDesktopSources(types: string[] = ['window', 'screen']): Promise<DesktopSource[]> {
  const electronAPI = window.electronAPI;

  if (!electronAPI?.getDesktopSources) {
    logger.error('Electron desktop capture API not available');
    return [];
  }

  try {
    return await electronAPI.getDesktopSources(types);
  } catch (error) {
    logger.error('Failed to get desktop sources:', error);
    return [];
  }
}

/**
 * Get a media stream for the selected source
 */
export async function getElectronScreenStream(sourceId: string): Promise<MediaStream | null> {
  const electronAPI = window.electronAPI;

  if (!electronAPI?.getScreenStream) {
    logger.error('Electron screen stream API not available');
    return null;
  }

  try {
    return await electronAPI.getScreenStream(sourceId);
  } catch (error) {
    logger.error('Failed to get screen stream:', error);
    return null;
  }
}

/**
 * Get the primary screen source (usually the first screen)
 */
export async function getPrimaryScreenSource(): Promise<DesktopSource | null> {
  const sources = await getDesktopSources(['screen']);
  return sources.length > 0 ? sources[0] : null;
}

/**
 * Get a screen stream for Electron, automatically selecting the primary screen
 * This provides a simpler API when you don't need a source selector UI
 */
export async function getElectronScreenShareStream(): Promise<MediaStream | null> {
  if (!isElectron()) {
    logger.warn('Not running in Electron, screen share may not work correctly');
    return null;
  }

  // Get the primary screen source
  const primarySource = await getPrimaryScreenSource();
  if (!primarySource) {
    logger.error('No screen sources available');
    return null;
  }

  // Get the stream for this source
  return await getElectronScreenStream(primarySource.id);
}

/**
 * @deprecated Do not use with LiveKit. This function conflicts with LiveKit's internal media handling.
 * Use Electron's session.setDisplayMediaRequestHandler() in the main process instead.
 *
 * Override the browser's getDisplayMedia to work with Electron
 * This function is kept for reference but should not be called when using LiveKit.
 * It will cause black screens and room disconnections.
 */
export function overrideGetDisplayMediaForElectron(): void {
  if (!isElectron()) {
    return; // Only override in Electron
  }

  // Store the original function
  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;

  // Override with our Electron implementation
  navigator.mediaDevices.getDisplayMedia = async function(constraints?: DisplayMediaStreamOptions): Promise<MediaStream> {
    logger.dev('getDisplayMedia called in Electron, using desktopCapturer');

    try {
      // Get available sources
      const sources = await getDesktopSources(['screen', 'window']);

      if (sources.length === 0) {
        throw new Error('No desktop sources available');
      }

      // For now, automatically select the primary screen
      // In a future enhancement, we could show a source selector UI
      const primaryScreen = sources.find(s => s.name.includes('Screen')) || sources[0];

      // Get the stream
      const stream = await getElectronScreenStream(primaryScreen.id);

      if (!stream) {
        throw new Error('Failed to capture screen');
      }

      // Add audio track if requested
      if (constraints?.audio) {
        try {
          // Try to get system audio (this may not work on all platforms)
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-expect-error - Electron-specific
              mandatory: {
                chromeMediaSource: 'desktop'
              }
            },
            video: false
          });

          audioStream.getAudioTracks().forEach(track => {
            stream.addTrack(track);
          });
        } catch (audioError) {
          logger.warn('Failed to capture system audio:', audioError);
          // Continue without audio
        }
      }

      return stream;
    } catch (error) {
      logger.error('Electron getDisplayMedia override failed:', error);

      // Fall back to original implementation if available
      if (originalGetDisplayMedia) {
        return originalGetDisplayMedia.call(navigator.mediaDevices, constraints);
      }

      throw error;
    }
  };

  logger.dev('getDisplayMedia overridden for Electron');
}
