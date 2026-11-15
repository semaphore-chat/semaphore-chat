import { useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useVoiceConnection } from "./useVoiceConnection";
import { isSigningOut, signOutSession, subscribeSigningOut } from "../utils/signOutSession";
import type { LoginLocationState } from "../pages/LoginPage";

/**
 * The app's logout flow (signOutSession): leave voice, call the logout
 * endpoint (with a timeout), then always end the local session and navigate
 * to /login.
 *
 * `logoutLoading` is true while any sign-out runs (shared by every control);
 * `handleLogout` during one returns the running one.
 */
export function useLogout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logoutLoading = useSyncExternalStore(subscribeSigningOut, isSigningOut);
  const { state: voiceState, actions: voiceActions } = useVoiceConnection();

  /**
   * @param loginState - Router state for the login page (e.g. where to
   *   return to after signing in as someone else)
   */
  const handleLogout = (loginState?: LoginLocationState) =>
    signOutSession({
      queryClient,
      voiceConnected: voiceState.isConnected,
      leaveVoice: voiceActions.leaveVoiceChannel,
      navigate,
      loginState,
    });

  return { handleLogout, logoutLoading };
}
