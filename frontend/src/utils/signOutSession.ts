import type { QueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";
import { disconnectSocket } from "./socketSingleton";
import { clearSavedConnection } from "../features/voice/voiceActions";
import { getElectronRefreshToken, markServerSignOutOwed } from "./tokenService";
import { isElectron } from "./platform";
import { endLocalSession } from "./endLocalSession";
import { requestServerLogout } from "./serverSignOut";
import type { LoginLocationState } from "../pages/LoginPage";

export interface SignOutSessionOptions {
  queryClient: QueryClient;
  voiceConnected: boolean;
  leaveVoice: () => Promise<unknown>;
  navigate: NavigateFunction;
  /** Router state for the login page (e.g. where to return to after signing in as someone else) */
  loginState?: LoginLocationState;
}

let inProgress: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setInProgress(value: Promise<void> | null) {
  inProgress = value;
  listeners.forEach((listener) => listener());
}

/** Whether a user-initiated sign-out is running. */
export function isSigningOut(): boolean {
  return inProgress !== null;
}

/** Subscribe to isSigningOut() changes (for useSyncExternalStore). */
export function subscribeSigningOut(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function run({
  queryClient,
  voiceConnected,
  leaveVoice,
  navigate,
  loginState,
}: SignOutSessionOptions): Promise<void> {
  if (voiceConnected) {
    try {
      await leaveVoice();
    } catch {
      // Best effort — don't block logout
    }
  }
  // Before the logout call: no rejoin and no socket events (the server's
  // SESSION_TERMINATED for this very logout) while it runs
  clearSavedConnection();
  disconnectSocket();
  let confirmed = false;
  try {
    // Electron clients must send refresh token in body since cookies don't work cross-origin
    const refreshToken = isElectron() ? (await getElectronRefreshToken()) ?? undefined : undefined;
    confirmed = await requestServerLogout(refreshToken);
  } catch {
    // Reading the Electron refresh token failed: nothing was sent
  } finally {
    // On the web only the server can delete the httpOnly refresh cookie:
    // until it confirms, the cookie must not sign anyone back in. (Electron
    // deletes its stored refresh token in clearTokens.)
    if (!confirmed && !isElectron()) markServerSignOutOwed();
    endLocalSession(queryClient);
    if (loginState) navigate("/login", { state: loginState });
    else navigate("/login");
  }
}

/**
 * The one user-initiated sign-out sequence (useLogout, behind every sign-out
 * control): leave voice (best effort), forget the saved voice connection and
 * drop the socket, call the logout endpoint (at most LOGOUT_REQUEST_TIMEOUT_MS,
 * with the Electron refresh token in the body), then always run the shared
 * local teardown (endLocalSession) and navigate to /login. Local sign-out
 * completes promptly even if the server can't be reached; on the web the
 * server sign-out is then owed (see serverSignOut.ts).
 *
 * A call while one is running returns the running one: a second click does
 * nothing.
 */
export function signOutSession(options: SignOutSessionOptions): Promise<void> {
  if (inProgress) return inProgress;
  const promise = run(options).finally(() => setInProgress(null));
  setInProgress(promise);
  return promise;
}
