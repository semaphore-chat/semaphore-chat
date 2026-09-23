import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { authControllerLogoutMutation } from "../api-client/@tanstack/react-query.gen";
import { useVoiceConnection } from "./useVoiceConnection";
import { disconnectSocket } from "../utils/socketSingleton";
import { clearSavedConnection } from "../features/voice/voiceActions";
import { clearTokens, getElectronRefreshToken } from "../utils/tokenService";
import { isElectron } from "../utils/platform";
import { clearComposerDrafts } from "./useComposerDraft";

/**
 * Encapsulates the app's logout flow: leave voice (best effort), tear down
 * the local voice connection + socket state, call the logout mutation
 * (best effort, sending the Electron refresh token in the body when
 * applicable), then always clear tokens and navigate to /login — local
 * logout completes even if the server-side revocation fails.
 */
export function useLogout() {
  const navigate = useNavigate();
  const { mutateAsync: logout, isPending: logoutLoading } = useMutation(authControllerLogoutMutation());
  const { state: voiceState, actions: voiceActions } = useVoiceConnection();

  const handleLogout = async () => {
    // Disconnect voice if connected
    if (voiceState.isConnected) {
      try {
        await voiceActions.leaveVoiceChannel();
      } catch {
        // Best effort — don't block logout
      }
    }
    clearSavedConnection();
    disconnectSocket();
    try {
      // Electron clients must send refresh token in body since cookies don't work cross-origin
      const refreshToken = isElectron() ? (await getElectronRefreshToken()) ?? undefined : undefined;
      await logout({ body: { refreshToken } });
    } catch {
      // Best effort — the server-side session revocation can fail (network
      // error, already-expired session), but local logout must still
      // complete: clear tokens and leave the authenticated UI regardless.
    } finally {
      clearTokens();
      // Unsent drafts are per browser tab, not per user: drop them so the
      // next account signed in on this tab never sees them.
      clearComposerDrafts();
      navigate("/login");
    }
  };

  return { handleLogout, logoutLoading };
}
