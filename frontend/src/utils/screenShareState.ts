/**
 * Screen Share State Management
 *
 * Manages screen share settings for Electron integration.
 * Uses window properties for Electron main process communication,
 * but provides a type-safe interface and proper cleanup.
 */

export interface ScreenShareSettings {
  resolution: string;
  fps: number;
  enableAudio: boolean;
}

/**
 * Set screen share configuration for Electron
 * These values are read by Electron's main process setDisplayMediaRequestHandler
 */
export function setScreenShareConfig(sourceId: string, settings: ScreenShareSettings): void {
  if (typeof window !== 'undefined') {
    window.__selectedScreenSourceId = sourceId;
    window.__screenShareSettings = settings;
  }
}

/**
 * Get screen share settings
 */
export function getScreenShareSettings(): ScreenShareSettings | undefined {
  if (typeof window !== 'undefined') {
    return window.__screenShareSettings;
  }
  return undefined;
}

/**
 * Get selected screen source ID
 */
export function getScreenSourceId(): string | undefined {
  if (typeof window !== 'undefined') {
    return window.__selectedScreenSourceId;
  }
  return undefined;
}

/**
 * Clear screen share configuration
 * Should be called when screen sharing ends
 */
export function clearScreenShareConfig(): void {
  if (typeof window !== 'undefined') {
    delete window.__selectedScreenSourceId;
    delete window.__screenShareSettings;
  }
}

/**
 * Default screen share settings
 */
// Matches the Electron picker's default (ScreenSourcePicker). The web has no
// picker of its own (the browser's chooses the source), so this is what every
// browser screen share gets.
export const DEFAULT_SCREEN_SHARE_SETTINGS: ScreenShareSettings = {
  resolution: '1080p',
  fps: 60,
  enableAudio: true,
};
