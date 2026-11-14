/**
 * Environment configuration for frontend
 * Provides configurable URLs for API and WebSocket connections
 */

import { getActiveServer } from '../utils/serverStorage';
import { isElectron } from '../utils/platform';

/**
 * Get the base API URL from environment variables or fallback to default
 * In production Electron builds, this should point to the backend server
 */
export const getApiBaseUrl = (): string => {
  // Try to get from environment variable first
  const envUrl = import.meta.env.VITE_API_URL;

  if (envUrl) {
    return envUrl;
  }

  // Electron: use configured server
  if (isElectron()) {
    const activeServer = getActiveServer();
    if (activeServer) {
      return `${activeServer.url}/api`;
    }
    // No server configured - ConnectionWizard should handle this
    return '';
  }

  // Web: use relative path (works with Vite proxy)
  return '/api';
};

/**
 * Get the WebSocket URL from environment variables or fallback to default
 * In production Electron builds, this should point to the backend server
 */
export const getWebSocketUrl = (): string => {
  // Try to get from environment variable first
  const envUrl = import.meta.env.VITE_WS_URL;

  if (envUrl) {
    return envUrl;
  }

  // Electron: use configured server
  if (isElectron()) {
    const activeServer = getActiveServer();
    if (activeServer) {
      return activeServer.url;
    }
    // No server configured - ConnectionWizard should handle this
    return '';
  }

  // Web: use current origin
  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }

  return 'http://localhost:3000';
};

/**
 * Get the instance URL (origin) for building user-facing links (e.g. invite URLs).
 * In Electron, window.location.origin is file:// so we use the configured server URL.
 * In web, window.location.origin is correct.
 */
export const getInstanceUrl = (): string => {
  if (isElectron()) {
    const activeServer = getActiveServer();
    if (activeServer) {
      return activeServer.url;
    }
    return '';
  }

  if (typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }

  return 'http://localhost:3000';
};

/**
 * Normalise a server or API URL for comparison: lower-case scheme and host
 * (URL does this), default port dropped, trailing slashes removed. A value
 * that isn't an absolute URL is only trimmed of trailing slashes.
 */
export const normalizeUrlForComparison = (url: string): string => {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

/**
 * Get full API endpoint URL
 * @param path - API endpoint path (e.g., '/auth/login')
 */
export const getApiUrl = (path: string): string => {
  const baseUrl = getApiBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
};
