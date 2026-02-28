import { useState, useEffect } from "react";
import { Outlet, Navigate } from "react-router-dom";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { onboardingControllerGetStatusOptions } from "../api-client/@tanstack/react-query.gen";
import {
  getAccessToken,
  refreshToken,
  clearTokens,
  onAuthFailure,
} from "../utils/tokenService";
import { disconnectSocket } from "../utils/socketSingleton";
import { userControllerGetProfile } from "../api-client/sdk.gen";
import { SocketProvider } from "../utils/SocketProvider";
import { AvatarCacheProvider } from "../contexts/AvatarCacheContext";
import { NotificationProvider } from "../contexts/NotificationContext";
import { VoiceProvider } from "../contexts/VoiceContext";
import { ConnectionStatusBanner } from "./ConnectionStatusBanner";
import { RoomProvider } from "../contexts/RoomContext";
import { ThreadPanelProvider } from "../contexts/ThreadPanelContext";
import { UserProfileProvider } from "../contexts/UserProfileContext";
import { logger } from "../utils/logger";

type AuthState = "loading" | "needs-onboarding" | "unauthenticated" | "authenticated";

export function AuthGate() {
  const [authState, setAuthState] = useState<AuthState>("loading");

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
      setAuthState("needs-onboarding");
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
    return onAuthFailure(() => {
      disconnectSocket();
      clearTokens();
      setAuthState("unauthenticated");
    });
  }, []);

  async function validateToken() {
    const token = getAccessToken();

    if (!token) {
      // No in-memory token (e.g. page refresh). Attempt silent refresh
      // using httpOnly refresh_token cookie (web) or stored token (Electron).
      logger.dev("[AuthGate] No token in memory, attempting silent refresh...");
      try {
        const newToken = await refreshToken();
        if (newToken) {
          setAuthState("authenticated");
          return;
        }
      } catch {
        // Refresh failed — user must log in
      }

      setAuthState("unauthenticated");
      return;
    }

    // Verify token server-side — catches expiry, revocation, clock skew, etc.
    // The 401 response interceptor will attempt a refresh automatically.
    try {
      const { error } = await userControllerGetProfile();
      if (!error) {
        setAuthState("authenticated");
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
        setAuthState("authenticated");
        return;
      }
    } catch {
      // Refresh failed
    }

    disconnectSocket();
    clearTokens();
    setAuthState("unauthenticated");
  }

  if (authState === "loading") {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
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

  if (authState === "needs-onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  if (authState === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  // Authenticated — render providers and child routes
  return (
    <SocketProvider>
      <AvatarCacheProvider>
        <NotificationProvider>
          <VoiceProvider>
            <ConnectionStatusBanner />
            <RoomProvider>
              <ThreadPanelProvider>
                <UserProfileProvider>
                  <Outlet />
                </UserProfileProvider>
              </ThreadPanelProvider>
            </RoomProvider>
          </VoiceProvider>
        </NotificationProvider>
      </AvatarCacheProvider>
    </SocketProvider>
  );
}

export default AuthGate;
