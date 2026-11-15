import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { authControllerLogoutMutation } from "../api-client/@tanstack/react-query.gen";
import { useVoiceConnection } from "./useVoiceConnection";
import { signOutSession } from "../utils/signOutSession";
import type { LoginLocationState } from "../pages/LoginPage";

/**
 * Encapsulates the app's logout flow: leave voice (best effort), tear down
 * the local voice connection + socket state, call the logout mutation
 * (best effort, sending the Electron refresh token in the body when
 * applicable), then always clear tokens and navigate to /login — local
 * logout completes even if the server-side revocation fails.
 */
export function useLogout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mutateAsync: logout, isPending: logoutLoading } = useMutation(authControllerLogoutMutation());
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
      logout: (refreshToken) => logout({ body: { refreshToken } }),
      navigate,
      loginState,
    });

  return { handleLogout, logoutLoading };
}
