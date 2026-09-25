import { useState, useEffect, useRef, type RefObject } from "react";
import { Outlet, Navigate, useNavigate } from "react-router-dom";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { onboardingControllerGetStatusOptions } from "../api-client/@tanstack/react-query.gen";
import {
  getAccessToken,
  refreshSessionUntilAnswered,
  endRefreshCooldown,
  clearTokens,
  onAuthFailure,
  type RefreshResult,
  type SignOutReason,
} from "../utils/tokenService";
import { disconnectSocket } from "../utils/socketSingleton";
import { userControllerGetProfile } from "../api-client/sdk.gen";
import { SocketProvider } from "../utils/SocketProvider";
import { AvatarCacheProvider } from "../contexts/AvatarCacheContext";
import { NotificationProvider } from "../contexts/NotificationContext";
import { SecureStorageWarning } from "./Electron/SecureStorageWarning";
import { takeStashedDeepLinkRoute } from "../utils/deepLinkStash";
import { mapDeepLinkRouteToPath } from "../utils/deepLinkRoute";
import { VoiceProvider } from "../contexts/VoiceProvider";
import { ConnectionStatusBanner } from "./ConnectionStatusBanner";
import { RoomProvider } from "../contexts/RoomContext";
import { SpeakingProvider } from "../contexts/SpeakingContext";
import { ThreadPanelProvider } from "../contexts/ThreadPanelProvider";
import { UserProfileProvider } from "../contexts/UserProfileProvider";
import { logger } from "../utils/logger";
import { PAGE_LOAD_REFRESH_ROUNDS } from "../utils/sessionRefreshPolicy";
import { SessionUnavailable } from "./SessionUnavailable";
import type { LoginLocationState } from "../pages/LoginPage";

enum AuthState {
  Loading = "loading",
  NeedsOnboarding = "needs-onboarding",
  Unauthenticated = "unauthenticated",
  Authenticated = "authenticated",
  /** The server kept failing: offer to try again or sign in again */
  Unavailable = "unavailable",
}

/**
 * Get an access token through the refresh token (cookie, or Electron's
 * stored token). Only a refused session (401/403, no refresh token) means
 * signing in again. When the server can't answer (network error, 5xx, 429),
 * AuthGate keeps "Connecting..." and tries again (refreshSessionUntilAnswered):
 * the login page would sign out a user whose session is fine. After
 * PAGE_LOAD_REFRESH_ROUNDS failed rounds it stops ("unavailable"), and
 * AuthGate lets the user try again or sign in again.
 * @param abortRef - Holds the AbortController of the refresh in progress; a
 *   new call aborts the previous one, and AuthGate aborts it on unmount
 * @returns How the refresh ended, or null if aborted meanwhile
 */
async function refreshSessionOnLoad(
  abortRef: RefObject<AbortController | null>
): Promise<RefreshResult["status"] | null> {
  abortRef.current?.abort();
  const abort = new AbortController();
  abortRef.current = abort;
  const result = await refreshSessionUntilAnswered(abort.signal, {
    maxRounds: PAGE_LOAD_REFRESH_ROUNDS,
  });
  if (abort.signal.aborted) return null;
  return result.status;
}

/** The auth state a page-load refresh leads to. */
function authStateAfterRefresh(status: RefreshResult["status"]): AuthState {
  switch (status) {
    case "refreshed":
      return AuthState.Authenticated;
    case "unavailable":
      return AuthState.Unavailable;
    default:
      return AuthState.Unauthenticated;
  }
}

export function AuthGate() {
  const [authState, setAuthState] = useState<AuthState>(AuthState.Loading);
  // Why the server signed us out, for the login page to explain
  const [signOutReason, setSignOutReason] = useState<SignOutReason | null>(null);
  const navigate = useNavigate();
  // Ends a session refresh still waiting for the server when AuthGate unmounts
  const refreshAbort = useRef<AbortController | null>(null);
  useEffect(() => () => refreshAbort.current?.abort(), []);

  // Phase 1: Onboarding check (no auth required)
  const {
    data: onboardingStatus,
    isLoading: isCheckingOnboarding,
    isSuccess: onboardingChecked,
    isError: onboardingCheckFailed,
  } = useQuery(onboardingControllerGetStatusOptions());

  // Phase 2: Token validation (runs after onboarding check completes)
  useEffect(() => {
    // Still checking onboarding
    if (isCheckingOnboarding) return;

    // Onboarding needed
    if (onboardingChecked && onboardingStatus?.needsSetup) {
      setAuthState(AuthState.NeedsOnboarding);
      return;
    }

    // Onboarding check failed — could be network error on first load.
    // Fall through to token check so the app doesn't get stuck.
    // If server is unreachable, authenticated requests will also fail.

    // Onboarding done (or check failed) → validate token
    if (onboardingChecked || onboardingCheckFailed) {
      validateToken();
    }
  }, [isCheckingOnboarding, onboardingChecked, onboardingCheckFailed, onboardingStatus]);

  // Listen for unrecoverable 401s during the session (e.g. refresh token
  // expired while the user was browsing). The interceptor calls
  // notifyAuthFailure() instead of performing navigation/cleanup itself.
  useEffect(() => {
    return onAuthFailure((reason) => {
      disconnectSocket();
      clearTokens();
      setSignOutReason(reason ?? null);
      setAuthState(AuthState.Unauthenticated);
    });
  }, []);

  // Flush any deep link stashed by useDeepLinks (mounted in App.tsx, alive
  // even while unauthenticated) once sign-in completes. AuthGate is the one
  // place every sign-in path — LoginPage, RegisterPage, JoinInvitePage,
  // onboarding completion, and silent refresh — funnels through and
  // observes Authenticated, so it's the right place to own the flush.
  useEffect(() => {
    if (authState !== AuthState.Authenticated) return;
    const pending = takeStashedDeepLinkRoute();
    if (!pending) return;
    const path = mapDeepLinkRouteToPath(pending);
    if (path) navigate(path);
  }, [authState, navigate]);

  async function validateToken() {
    const token = getAccessToken();

    if (!token) {
      // No in-memory token (e.g. page refresh). Attempt silent refresh
      // using httpOnly refresh_token cookie (web) or stored token (Electron).
      logger.dev("[AuthGate] No token in memory, attempting silent refresh...");
      const status = await refreshSessionOnLoad(refreshAbort);
      if (status === null) return;
      setAuthState(authStateAfterRefresh(status));
      return;
    }

    // Verify token server-side — catches expiry, revocation, clock skew, etc.
    // The 401 response interceptor will attempt a refresh automatically.
    try {
      const { error } = await userControllerGetProfile();
      if (!error) {
        setAuthState(AuthState.Authenticated);
        return;
      }
    } catch {
      // Network error or other failure — fall through to refresh
    }

    // Server rejected the token (or network error) — try explicit refresh
    logger.dev("[AuthGate] Server validation failed, attempting refresh...");
    const status = await refreshSessionOnLoad(refreshAbort);
    if (status === null) return;
    if (status !== "rejected") {
      setAuthState(authStateAfterRefresh(status));
      return;
    }

    disconnectSocket();
    clearTokens();
    setAuthState(AuthState.Unauthenticated);
  }

  /** "Try again": a new attempt now, without waiting out a pause. */
  function retryAfterUnavailable() {
    endRefreshCooldown();
    setAuthState(AuthState.Loading);
    void validateToken();
  }

  /** "Sign in again": forget the session this device holds. */
  function signInAgain() {
    refreshAbort.current?.abort();
    disconnectSocket();
    clearTokens();
    setSignOutReason(null);
    setAuthState(AuthState.Unauthenticated);
  }

  if (authState === AuthState.Loading) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "var(--full-dvh)",
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          Connecting...
        </Typography>
      </Box>
    );
  }

  if (authState === AuthState.Unavailable) {
    return (
      <SessionUnavailable onRetry={retryAfterUnavailable} onSignIn={signInAgain} />
    );
  }

  if (authState === AuthState.NeedsOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  if (authState === AuthState.Unauthenticated) {
    const state: LoginLocationState | undefined = signOutReason
      ? { signOutReason }
      : undefined;
    return <Navigate to="/login" replace state={state} />;
  }

  // Authenticated — render providers and child routes
  return (
    <SocketProvider>
      <AvatarCacheProvider>
        <NotificationProvider>
          <SecureStorageWarning />
          <VoiceProvider>
            <ConnectionStatusBanner />
            <RoomProvider>
              <SpeakingProvider>
                <ThreadPanelProvider>
                  <UserProfileProvider>
                    <Outlet />
                  </UserProfileProvider>
                </ThreadPanelProvider>
              </SpeakingProvider>
            </RoomProvider>
          </VoiceProvider>
        </NotificationProvider>
      </AvatarCacheProvider>
    </SocketProvider>
  );
}

export default AuthGate;
