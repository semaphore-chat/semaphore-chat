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

// Event emitter for token refresh notifications
type TokenRefreshListener = (newToken: string) => void;
const refreshListeners: Set<TokenRefreshListener> = new Set();

// Event emitter for unrecoverable auth failures (e.g. refresh token expired)
type AuthFailureListener = () => void;
const authFailureListeners: Set<AuthFailureListener> = new Set();

// Mutex for preventing concurrent refresh attempts
let refreshPromise: Promise<string | null> | null = null;

/**
 * Get the current access token from localStorage.
 *
 * Handles backwards-compatible reading:
 * - Plain string (current format)
 * - JSON-encoded string (legacy: JSON.stringify wrapping)
 * - JSON object with `value` key (legacy: setCachedItem wrapping)
 */
export function getAccessToken(): string | null {
  const raw = localStorage.getItem("accessToken");
  if (!raw) return null;

  // Try JSON.parse for backwards compat with old formats
  try {
    const parsed = JSON.parse(raw);

    // Handle { value: "token" } format from old setCachedItem
    if (parsed && typeof parsed === "object" && "value" in parsed) {
      return parsed.value || null;
    }

    // Handle JSON-encoded string: JSON.stringify("token") → '"token"'
    if (typeof parsed === "string") {
      return parsed;
    }

    // Unknown object format
    logger.warn("[TokenService] Unexpected token format in localStorage:", typeof parsed);
    return null;
  } catch {
    // Not valid JSON — treat as plain string (current format)
    return raw;
  }
}

/**
 * Set the access token in localStorage as a plain string.
 */
export function setAccessToken(token: string): void {
  localStorage.setItem("accessToken", token);
}

/**
 * Clear all auth tokens from localStorage.
 */
export function clearTokens(): void {
  localStorage.removeItem("accessToken");
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
 * Append authentication token to a URL as a query parameter.
 *
 * Needed for embedded resources (<img>, <video>, <source> tags) that
 * cannot use Authorization headers.
 */
export function getAuthenticatedUrl(url: string): string {
  const token = getAccessToken();

  if (!token) {
    logger.warn("[TokenService] No token available for authenticated URL");
    return url;
  }

  try {
    const urlObj = new URL(url, window.location.origin);

    if (urlObj.searchParams.has("token")) {
      return url;
    }

    urlObj.searchParams.set("token", token);
    return urlObj.toString();
  } catch (error) {
    logger.error("[TokenService] Error creating authenticated URL:", error);
    return url;
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
 */
export function notifyAuthFailure(): void {
  authFailureListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      logger.error("[TokenService] Error in auth failure listener:", error);
    }
  });
}

/**
 * Perform the actual token refresh
 */
async function performRefresh(): Promise<string | null> {
  const isElectronApp = isElectron();

  try {
    let refreshResponse;

    if (isElectronApp) {
      const refreshToken = localStorage.getItem("refreshToken");
      if (!refreshToken) {
        throw new Error("No refresh token available for Electron client");
      }

      // For Electron, send refresh token in body
      refreshResponse = await axios.post<{
        accessToken: string;
        refreshToken?: string;
      }>(getApiUrl("/auth/refresh"), { refreshToken });
    } else {
      // For web clients, use cookie-based refresh
      refreshResponse = await axios.post<{ accessToken: string }>(
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
        localStorage.setItem("refreshToken", refreshResponse.data.refreshToken);
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

/**
 * Refresh the access token
 *
 * This function is idempotent - concurrent calls will share the same refresh promise,
 * preventing multiple simultaneous refresh requests.
 *
 * @returns The new access token, or null if refresh failed
 */
export async function refreshToken(): Promise<string | null> {
  // If a refresh is already in progress, wait for it
  if (refreshPromise) {
    logger.dev("[TokenService] Refresh already in progress, waiting...");
    return refreshPromise;
  }

  logger.dev("[TokenService] Starting token refresh");

  refreshPromise = performRefresh()
    .catch((error) => {
      logger.error("[TokenService] Refresh failed:", error);
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

/**
 * Check if a token refresh is currently in progress
 */
export function isRefreshing(): boolean {
  return refreshPromise !== null;
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
