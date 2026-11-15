import type { QueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";
import { disconnectSocket } from "./socketSingleton";
import { clearSavedConnection } from "../features/voice/voiceActions";
import { clearTokens, getElectronRefreshToken } from "./tokenService";
import { isElectron } from "./platform";
import { clearComposerDrafts } from "../hooks/useComposerDraft";
import { clearDesignPreview } from "../shell/designPreview";
import { clearSessionCaches } from "./clearSessionCaches";
import type { LoginLocationState } from "../pages/LoginPage";

export interface SignOutSessionOptions {
  queryClient: QueryClient;
  voiceConnected: boolean;
  leaveVoice: () => Promise<unknown>;
  /** Calls the logout endpoint; gets the Electron refresh token (undefined on the web). */
  logout: (refreshToken: string | undefined) => Promise<unknown>;
  navigate: NavigateFunction;
  /** Router state for the login page (e.g. where to return to after signing in as someone else) */
  loginState?: LoginLocationState;
}

/**
 * The one user-initiated sign-out sequence (useLogout and the mobile profile
 * panel share it so they cannot drift): leave voice (best effort), drop the
 * local voice connection and socket, call the logout endpoint (best effort,
 * with the Electron refresh token in the body), then always clear tokens,
 * per-tab state and the caches and navigate to /login. Local sign-out
 * completes even if the server-side revocation fails.
 */
export async function signOutSession({
  queryClient,
  voiceConnected,
  leaveVoice,
  logout,
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
  clearSavedConnection();
  disconnectSocket();
  try {
    // Electron clients must send refresh token in body since cookies don't work cross-origin
    const refreshToken = isElectron() ? (await getElectronRefreshToken()) ?? undefined : undefined;
    await logout(refreshToken);
  } catch {
    // Best effort — the server-side session revocation can fail (network
    // error, already-expired session), but local logout must still complete.
  } finally {
    clearTokens();
    // Unsent drafts are per browser tab, not per user: drop them so the
    // next account signed in on this tab never sees them.
    clearComposerDrafts();
    // Likewise this tab's design preview (`?design=` links).
    clearDesignPreview();
    // And the previous account's server state (profile, communities, DMs...).
    clearSessionCaches(queryClient);
    if (loginState) navigate("/login", { state: loginState });
    else navigate("/login");
  }
}
