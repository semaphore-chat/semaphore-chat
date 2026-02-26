/**
 * Platform Detection Utility
 *
 * Provides centralized platform detection and feature checking for web vs Electron environments.
 * This utility helps maintain clean separation between platform-specific code.
 */

import type { ElectronAPI } from "../types/electron-api";

/**
 * Platform types
 */
export enum Platform {
  ELECTRON = 'electron',
  WEB = 'web',
  MOBILE = 'mobile',
}

/**
 * Check if running in Electron environment
 * Checks for electronAPI exposed by preload script
 */
export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && window.electronAPI?.isElectron === true;
};

/**
 * Check if running in web browser (not Electron)
 */
export const isWeb = (): boolean => {
  return typeof window !== 'undefined' && !isElectron();
};

/**
 * Check if running in Electron on Linux Wayland.
 * On Wayland, the custom screen source picker is skipped in favor of
 * the native PipeWire/XDG Desktop Portal dialog.
 */
export const isWayland = (): boolean => {
  return isElectron() && window.electronAPI?.isWayland === true;
};

/**
 * Check if running on mobile device
 */
export const isMobile = (): boolean => {
  return typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
};

/**
 * Check if running on desktop browser (not Electron, not mobile)
 * Used to differentiate desktop web from mobile web
 */
export const isDesktopBrowser = (): boolean => {
  return isWeb() && !isMobile();
};

/**
 * Get current platform
 */
export const getPlatform = (): Platform => {
  if (isElectron()) {
    return Platform.ELECTRON;
  }
  if (isMobile()) {
    return Platform.MOBILE;
  }
  return Platform.WEB;
};

/**
 * Check if a specific Electron API feature is available
 */
export const hasElectronFeature = (feature: string): boolean => {
  return isElectron() && typeof window.electronAPI?.[feature] === 'function';
};

/**
 * Get Electron API if available
 */
export const getElectronAPI = (): ElectronAPI | null => {
  return isElectron() ? window.electronAPI! : null;
};

/**
 * Feature detection for screen capture
 */
export const supportsScreenCapture = (): boolean => {
  if (isElectron()) {
    return hasElectronFeature('getDesktopSources');
  }
  return typeof navigator?.mediaDevices?.getDisplayMedia === 'function';
};

/**
 * Whether the platform supports system audio capture for screen sharing.
 * - Web browsers: no (getDisplayMedia doesn't support system audio for desktop capture)
 * - Electron Windows/macOS: yes (loopback + restrictOwnAudio in Chromium 140+)
 * - Electron Linux: no (restrictOwnAudio not supported by OS)
 */
export const supportsSystemAudio = (): boolean => {
  if (!isElectron()) return false;
  if (window.electronAPI?.platform === 'linux') return false;
  return true;
};

/**
 * Feature detection for getUserMedia (camera/microphone)
 */
export const supportsMediaDevices = (): boolean => {
  return typeof navigator?.mediaDevices?.getUserMedia === 'function';
};

/**
 * Check if running on HTTPS or localhost (required for some browser APIs)
 */
export const isSecureContext = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return (
    window.isSecureContext ||
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
};

/**
 * Platform-specific utilities
 */
export const platformUtils = {
  isElectron,
  isWayland,
  isWeb,
  isMobile,
  isDesktopBrowser,
  getPlatform,
  hasElectronFeature,
  getElectronAPI,
  supportsScreenCapture,
  supportsSystemAudio,
  supportsMediaDevices,
  isSecureContext,
} as const;

export default platformUtils;
