import { getApiBaseUrl } from '../config/env';

/**
 * The header the backend reads an install's device id from (#563): a sign-in
 * replaces the earlier sessions with the same id, and only those, so signing
 * in again on one device doesn't pile up sessions while two browser profiles
 * or app installs with the same user agent keep their own.
 */
export const DEVICE_ID_HEADER = 'X-Device-Id';

const STORAGE_KEY_PREFIX = 'semaphore:deviceId:';

/** Ids for when localStorage is unavailable: they last as long as the page. */
const memoryIds = new Map<string, string>();

/**
 * A random v4 UUID. crypto.randomUUID only exists in secure contexts, and a
 * self-hosted instance may be served over plain HTTP on a LAN;
 * getRandomValues works everywhere.
 */
function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * This install's device id for the current server: generated once, then
 * kept in localStorage (the renderer's, in Electron too). Keyed by server, so
 * the desktop app doesn't hand one id to every server it signs in to (they
 * could link the user's accounts by it); a browser has one server per origin.
 */
export function getDeviceId(): string {
  const key = `${STORAGE_KEY_PREFIX}${getApiBaseUrl()}`;
  try {
    const stored = localStorage.getItem(key);
    if (stored) return stored;
    const id = randomUuid();
    localStorage.setItem(key, id);
    return id;
  } catch {
    // Storage blocked (privacy settings): an id per page load, which only
    // means sign-ins from here don't replace earlier sessions
    let id = memoryIds.get(key);
    if (!id) {
      id = randomUuid();
      memoryIds.set(key, id);
    }
    return id;
  }
}

/** The headers that identify this install to the auth endpoints. */
export function deviceIdHeaders(): Record<string, string> {
  return { [DEVICE_ID_HEADER]: getDeviceId() };
}
