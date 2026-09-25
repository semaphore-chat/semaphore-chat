/**
 * Centralized Token Refresh Service
 *
 * This service provides a single source of truth for token refresh operations,
 * preventing race conditions and ensuring consistent auth state across HTTP and WebSocket.
 */

import axios from "axios";
import { getApiUrl } from "../config/env";
import { isElectron } from "./platform";
import { logger } from "./logger";
import type { SessionTerminatedReason } from "@semaphore-chat/shared";

// Event emitter for token refresh notifications
type TokenRefreshListener = (newToken: string) => void;
const refreshListeners: Set<TokenRefreshListener> = new Set();

/**
 * Why the user was signed out, when the server said so (SESSION_TERMINATED).
 * The login page explains some of them.
 */
export type SignOutReason = SessionTerminatedReason;

// Event emitter for unrecoverable auth failures (e.g. refresh token expired)
type AuthFailureListener = (reason?: SignOutReason) => void;
const authFailureListeners: Set<AuthFailureListener> = new Set();

/**
 * How a token refresh went:
 * - refreshed: a new access token
 * - rejected: the server refused the session (401/403, or no refresh token
 *   to send); only signing in again helps
 * - unavailable: no answer about the session (network error, 5xx, 429...);
 *   trying again later may work
 */
export type RefreshResult =
  | { status: "refreshed"; token: string }
  | { status: "rejected" }
  | { status: "unavailable" };

// Mutex for preventing concurrent refresh attempts
let refreshPromise: Promise<RefreshResult> | null = null;

/** Thrown when there is no refresh token to send (Electron). */
class NoRefreshTokenError extends Error {}

// ─── Secure Storage Availability Warning (Electron) ─────────────────────────
//
// When the OS keychain isn't available (e.g. no keyring daemon on Linux),
// or the encrypted write itself fails despite the keychain being available,
// storeElectronRefreshToken() falls back to persisting the refresh token in
// plain localStorage instead of encrypted OS-backed storage. That's an
// invisible security downgrade unless we surface it. We log every occurrence
// (for diagnostics/support), but only ever show the user-visible UI warning
// once — see `onSecureStorageWarning` below, subscribed to by
// `SecureStorageWarning` (components/Electron/SecureStorageWarning.tsx).
//
// Delivery has two paths, because the very first (and often only, in dev)
// unavailable-store event usually happens during AuthGate's pre-mount silent
// refresh on cold launch (AuthGate.tsx validateToken()) — before
// NotificationProvider/SecureStorageWarning exist anywhere in the tree. The
// same is true of LoginPage/RegisterPage/JoinInvitePage/onboarding's
// CompletionStep, which all persist a token before the authenticated shell
// mounts. Waiting for a live listener to eventually show up is not reliable:
// on a cold launch the *next* trigger is typically next launch's pre-mount
// refresh again, so the live-only approach could mean the user never sees
// the warning even though it fires every launch.
//
// So: `SECURE_STORAGE_WARNING_KEY` is the "shown" flag — once set, the
// warning never shows again, full stop. `SECURE_STORAGE_WARNING_PENDING_KEY`
// is a separate, durable "pending" marker: set whenever an unavailable
// persist happens with no live listener subscribed. `SecureStorageWarning`
// consumes it at mount time (see `consumePendingSecureStorageWarning`),
// which closes the gap — the warning is guaranteed to surface the next time
// the authenticated shell mounts, with no further trigger event required.

const SECURE_STORAGE_WARNING_KEY = "semaphore:secureStorageWarningShown";
const SECURE_STORAGE_WARNING_PENDING_KEY = "semaphore:secureStorageWarningPending";

type SecureStorageWarningListener = () => void;
const secureStorageWarningListeners: Set<SecureStorageWarningListener> = new Set();

/**
 * Subscribe to the one-time "secure storage unavailable" warning's live
 * delivery path (used when a listener is already mounted at trigger time).
 * @returns Unsubscribe function
 */
export function onSecureStorageWarning(listener: SecureStorageWarningListener): () => void {
  secureStorageWarningListeners.add(listener);
  return () => secureStorageWarningListeners.delete(listener);
}

/**
 * Consume a pending "secure storage unavailable" warning at mount time.
 *
 * Called by `SecureStorageWarning` on mount. Returns true (and marks the
 * warning permanently shown) exactly once — the first time a pending
 * warning is found and the warning hasn't already been shown/dismissed.
 * This is what makes delivery work even when no event fires after mount:
 * the pending flag was already persisted in localStorage by an earlier,
 * pre-mount `triggerSecureStorageWarning()` call.
 */
export function consumePendingSecureStorageWarning(): boolean {
  if (localStorage.getItem(SECURE_STORAGE_WARNING_KEY) === "true") {
    // Already shown/dismissed — pending is irrelevant now; clear it
    // defensively so it doesn't linger.
    localStorage.removeItem(SECURE_STORAGE_WARNING_PENDING_KEY);
    return false;
  }

  if (localStorage.getItem(SECURE_STORAGE_WARNING_PENDING_KEY) !== "true") {
    return false;
  }

  localStorage.setItem(SECURE_STORAGE_WARNING_KEY, "true");
  localStorage.removeItem(SECURE_STORAGE_WARNING_PENDING_KEY);
  return true;
}

/**
 * Called whenever a token persist falls back to localStorage instead of
 * encrypted OS-backed storage. Always logs the supplied message (so it's
 * visible in devtools/support bundles on every affected launch — the message
 * distinguishes *why* the downgrade happened: keychain unavailable vs. a
 * failed write despite available encryption). If the warning has already
 * been shown (or dismissed), this is a no-op beyond logging. Otherwise:
 *  - if a listener is currently subscribed (live path), notify it
 *    immediately and mark the warning as permanently shown;
 *  - if not, persist a durable "pending" marker so `SecureStorageWarning`
 *    can consume it and show the warning as soon as it next mounts, even if
 *    this is the only trigger event that ever fires (see
 *    `consumePendingSecureStorageWarning`).
 */
function triggerSecureStorageWarning(logMessage: string): void {
  logger.warn(logMessage);

  if (localStorage.getItem(SECURE_STORAGE_WARNING_KEY) === "true") {
    return;
  }

  if (secureStorageWarningListeners.size === 0) {
    // No live listener mounted right now — persist a durable marker so a
    // later mount (e.g. SecureStorageWarning once the authenticated shell
    // renders) can still deliver the warning without needing another event.
    localStorage.setItem(SECURE_STORAGE_WARNING_PENDING_KEY, "true");
    return;
  }

  localStorage.setItem(SECURE_STORAGE_WARNING_KEY, "true");
  localStorage.removeItem(SECURE_STORAGE_WARNING_PENDING_KEY);
  secureStorageWarningListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      logger.error("[TokenService] Error in secure storage warning listener:", error);
    }
  });
}

// In-memory access token storage.
// Stored in a module-scoped variable instead of localStorage to prevent
// XSS-based token theft. On page refresh, the token is recovered via
// silent refresh using the httpOnly refresh_token cookie (web) or
// stored refresh token (Electron).
let accessTokenInMemory: string | null = null;

/**
 * Get the current access token from in-memory storage.
 */
export function getAccessToken(): string | null {
  return accessTokenInMemory;
}

/**
 * Set the access token in in-memory storage.
 */
export function setAccessToken(token: string): void {
  accessTokenInMemory = token;
}

/**
 * Clear all auth tokens.
 * Access token is cleared from memory; Electron refresh token from secure storage.
 */
export function clearTokens(): void {
  accessTokenInMemory = null;
  // Clear refresh token from secure storage (Electron) or localStorage (fallback)
  if (isElectron() && window.electronAPI?.deleteRefreshToken) {
    window.electronAPI.deleteRefreshToken().catch(() => {});
  }
  localStorage.removeItem("refreshToken");
}

/**
 * Check if a JWT token is expired (or will expire within `bufferSeconds`).
 *
 * Decodes the payload without verifying the signature — this is purely
 * a client-side convenience check before making network requests.
 *
 * @param token - The JWT string
 * @param bufferSeconds - Consider expired if within this many seconds of expiry (default 30)
 * @returns true if expired or unparseable, false if still valid
 */
export function isTokenExpired(token: string, bufferSeconds = 30): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;

    const payload = JSON.parse(atob(parts[1]));
    if (typeof payload.exp !== "number") return true;

    const nowSeconds = Date.now() / 1000;
    return payload.exp - bufferSeconds <= nowSeconds;
  } catch {
    return true;
  }
}


/**
 * Subscribe to token refresh events
 * @returns Unsubscribe function
 */
export function onTokenRefreshed(listener: TokenRefreshListener): () => void {
  refreshListeners.add(listener);
  return () => refreshListeners.delete(listener);
}

/**
 * Notify all listeners of a token refresh
 */
function notifyTokenRefreshed(newToken: string): void {
  refreshListeners.forEach((listener) => {
    try {
      listener(newToken);
    } catch (error) {
      logger.error("[TokenService] Error in token refresh listener:", error);
    }
  });
}

/**
 * Subscribe to unrecoverable auth failure events.
 *
 * Fired by the HTTP interceptor when a 401 cannot be resolved by refreshing.
 * AuthGate listens for this to redirect to login.
 *
 * @returns Unsubscribe function
 */
export function onAuthFailure(listener: AuthFailureListener): () => void {
  authFailureListeners.add(listener);
  return () => authFailureListeners.delete(listener);
}

/**
 * Notify all listeners of an unrecoverable auth failure.
 * @param reason - Why the server ended the session, if it said so
 */
export function notifyAuthFailure(reason?: SignOutReason): void {
  authFailureListeners.forEach((listener) => {
    try {
      listener(reason);
    } catch (error) {
      logger.error("[TokenService] Error in auth failure listener:", error);
    }
  });
}

/**
 * Perform the actual token refresh
 */
/**
 * Read the Electron refresh token from secure storage, falling back to
 * localStorage for backward compatibility with older Electron builds.
 */
export async function getElectronRefreshToken(): Promise<string | null> {
  // Try secure storage first
  try {
    if (window.electronAPI?.getRefreshToken) {
      const token = await window.electronAPI.getRefreshToken();
      if (token) {
        return token;
      }
    }
  } catch {
    logger.debug("[TokenService] Secure storage read failed, falling back to localStorage");
  }
  // Fall back to localStorage (migration path from older builds)
  return localStorage.getItem("refreshToken");
}

/**
 * Store the Electron refresh token in secure storage.
 * Also cleans up the legacy localStorage entry if present.
 */
export async function storeElectronRefreshToken(token: string): Promise<void> {
  try {
    if (window.electronAPI?.storeRefreshToken) {
      const result = await window.electronAPI.storeRefreshToken(token);
      if (result?.stored) {
        // Clean up legacy localStorage entry after successful migration
        localStorage.removeItem("refreshToken");
        return;
      }
      if (result?.availability === "unavailable") {
        triggerSecureStorageWarning(
          "[TokenService] Secure credential storage (OS keychain) is unavailable on this " +
          "system; your session token will be stored unencrypted in localStorage."
        );
      } else {
        // Encryption is AVAILABLE but the write itself failed (e.g. disk/IPC
        // error). This is still a silent security downgrade — log a distinct
        // message so support can tell it apart from keychain unavailability,
        // and surface the same one-time user-visible warning.
        triggerSecureStorageWarning(
          "[TokenService] Secure credential storage write failed even though OS keychain " +
          "encryption is available; your session token will be stored unencrypted in " +
          "localStorage."
        );
      }
      // Either way the encrypted write didn't happen — fall through to
      // localStorage below.
    }
  } catch {
    logger.debug("[TokenService] Secure storage write failed, falling back to localStorage");
  }
  // Fallback for older Electron builds or when safeStorage is unavailable
  localStorage.setItem("refreshToken", token);
}

/** Shape of the /auth/refresh response. Web responses omit refreshToken (cookie-based). */
interface RefreshResponseBody {
  accessToken: string;
  refreshToken?: string;
}

async function performRefresh(): Promise<string> {
  const isElectronApp = isElectron();

  try {
    let refreshResponse;

    if (isElectronApp) {
      const refreshToken = await getElectronRefreshToken();
      if (!refreshToken) {
        throw new NoRefreshTokenError("No refresh token available for Electron client");
      }

      // For Electron, send refresh token in body
      refreshResponse = await axios.post<RefreshResponseBody>(
        getApiUrl("/auth/refresh"),
        { refreshToken }
      );
    } else {
      // For web clients, use cookie-based refresh
      refreshResponse = await axios.post<RefreshResponseBody>(
        getApiUrl("/auth/refresh"),
        {},
        { withCredentials: true }
      );
    }

    if (refreshResponse?.data?.accessToken) {
      const newToken = refreshResponse.data.accessToken;
      setAccessToken(newToken);

      // Update stored refresh token for Electron
      if (isElectronApp && refreshResponse.data.refreshToken) {
        await storeElectronRefreshToken(refreshResponse.data.refreshToken);
      }

      logger.dev("[TokenService] Token refreshed successfully");
      notifyTokenRefreshed(newToken);
      return newToken;
    }

    throw new Error("No access token in refresh response");
  } catch (error) {
    logger.error("[TokenService] Token refresh failed:", error);
    throw error;
  }
}

/** Whether a refresh failure means the server refused the session. */
function isRefusal(error: unknown): boolean {
  if (error instanceof NoRefreshTokenError) return true;
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return status === 401 || status === 403;
}

/**
 * Refresh the access token, telling a refused session (sign in again) from
 * a failed attempt (try again later).
 *
 * Concurrent calls share the same refresh request.
 */
export function refreshSession(): Promise<RefreshResult> {
  // If a refresh is already in progress, wait for it
  if (refreshPromise) {
    logger.dev("[TokenService] Refresh already in progress, waiting...");
    return refreshPromise;
  }

  logger.dev("[TokenService] Starting token refresh");

  refreshPromise = performRefresh()
    .then((token): RefreshResult => ({ status: "refreshed", token }))
    .catch((error: unknown): RefreshResult => {
      logger.error("[TokenService] Refresh failed:", error);
      return { status: isRefusal(error) ? "rejected" : "unavailable" };
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

/**
 * Refresh the access token
 *
 * This function is idempotent - concurrent calls will share the same refresh promise,
 * preventing multiple simultaneous refresh requests.
 *
 * @returns The new access token, or null if refresh failed (for whatever
 *   reason; see refreshSession to tell them apart)
 */
export async function refreshToken(): Promise<string | null> {
  const result = await refreshSession();
  return result.status === "refreshed" ? result.token : null;
}

/**
 * Check if a token refresh is currently in progress
 */
export function isRefreshing(): boolean {
  return refreshPromise !== null;
}

/**
 * Check if user is authenticated (has a token in storage).
 *
 * Note: This only checks for token presence, not validity.
 */
export function isAuthenticated(): boolean {
  return getAccessToken() !== null;
}

/**
 * Redirect to login page
 */
export function redirectToLogin(): void {
  clearTokens();
  // Use hash for HashRouter compatibility (especially in Electron)
  if (window.location.hash !== "#/login") {
    window.location.hash = "#/login";
  }
}
