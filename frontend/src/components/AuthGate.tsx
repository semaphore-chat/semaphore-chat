import { useState, useEffect } from "react";
import { Outlet, Navigate, useNavigate } from "react-router-dom";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { onboardingControllerGetStatusOptions } from "../api-client/@tanstack/react-query.gen";
import {
  getAccessToken,
  refreshToken,
  clearTokens,
  onAuthFailure,
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
import { VoiceProvider } from "../contexts/VoiceContext";
import { ConnectionStatusBanner } from "./ConnectionStatusBanner";
import { RoomProvider } from "../contexts/RoomContext";
import { SpeakingProvider } from "../contexts/SpeakingContext";
import { ThreadPanelProvider } from "../contexts/ThreadPanelContext";
import { UserProfileProvider } from "../contexts/UserProfileContext";
import { logger } from "../utils/logger";
import type { LoginLocationState } from "../pages/LoginPage";

enum AuthState {
  Loading = "loading",
  NeedsOnboarding = "needs-onboarding",
  Unauthenticated = "unauthenticated",
  Authenticated = "authenticated",
}

export function AuthGate() {
  const [authState, setAuthState] = useState<AuthState>(AuthState.Loading);
  // Why the server signed us out, for the login page to explain
  const [signOutReason, setSignOutReason] = useState<SignOutReason | null>(null);
  const navigate = useNavigate();

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
      try {
        const newToken = await refreshToken();
        if (newToken) {
          setAuthState(AuthState.Authenticated);
          return;
        }
      } catch {
        // Refresh failed — user must log in
      }

      setAuthState(AuthState.Unauthenticated);
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
    try {
      const newToken = await refreshToken();
      if (newToken) {
        setAuthState(AuthState.Authenticated);
        return;
      }
    } catch {
      // Refresh failed
    }

    disconnectSocket();
    clearTokens();
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
