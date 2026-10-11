import React, { useEffect, useState } from "react";
import { logger } from "../utils/logger";
import {
  Box,
  Button,
  TextField,
  Typography,
  CircularProgress,
  Alert,
  Link,
  Divider,
} from "@mui/material";
import { LockOutlined } from "@mui/icons-material";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  authControllerLoginMutation,
  instanceControllerGetPublicSettingsOptions,
} from "../api-client/@tanstack/react-query.gen";
import { useNavigate, useLocation, Link as RouterLink } from "react-router-dom";
import {
  setAccessToken,
  storeElectronRefreshToken,
  type SignOutReason,
} from "../utils/tokenService";
import { safeLoginReturnTo } from "../utils/desktopLogin";
import { getActiveServer } from "../utils/serverStorage";
import { useElectronAPI } from "../contexts/ElectronContext";
import { consumeBrowserLoginOnLoad, useBrowserLogin } from "../hooks/useBrowserLogin";
import { BrowserLoginPanel } from "../components/Electron/BrowserLoginPanel";
import { ConnectionWizard } from "../components/Electron/ConnectionWizard";

/** Router state AuthGate passes when the server signed the user out. */
export interface LoginLocationState {
  signOutReason?: SignOutReason;
  /**
   * Where to go once signed in: only the desktop sign-in page
   * (safeLoginReturnTo), which sends signed-out users here first.
   */
  returnTo?: string;
}

/**
 * Sign-outs worth explaining. The others (logged out, session revoked or
 * expired) are what the user expects, or not theirs to act on.
 */
const SIGN_OUT_MESSAGES: Partial<Record<SignOutReason, string>> = {
  PASSWORD_CHANGED:
    "Your password was changed, so you were signed out. Sign in with the new password.",
  ACCOUNT_BANNED: "You were signed out because this account was banned.",
  ACCOUNT_DELETED: "You were signed out because this account was deleted.",
};

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { mutateAsync: login, isPending: isLoading, error } = useMutation(authControllerLoginMutation());
  const { data: publicSettings } = useQuery(instanceControllerGetPublicSettingsOptions());
  const navigate = useNavigate();
  const locationState = useLocation().state as LoginLocationState | null;
  const signOutReason = locationState?.signOutReason;
  const returnTo = safeLoginReturnTo(locationState?.returnTo);
  const electronAPI = useElectronAPI();
  const activeServer = electronAPI ? getActiveServer() : null;
  const [changingServer, setChangingServer] = useState(false);
  const browserLogin = useBrowserLogin(() => navigate("/"));
  const { available: browserLoginAvailable, start: startBrowserLogin } = browserLogin;

  // The connection wizard's "Sign in with browser" (before its reload)
  useEffect(() => {
    if (browserLoginAvailable && consumeBrowserLoginOnLoad()) {
      void startBrowserLogin();
    }
  }, [browserLoginAvailable, startBrowserLogin]);
  const signOutMessage = signOutReason
    ? SIGN_OUT_MESSAGES[signOutReason]
    : undefined;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const response = await login({ body: { username, password } });
      setAccessToken(response.accessToken);

      // Store refresh token for Electron clients (secure storage)
      if (response.refreshToken) {
        await storeElectronRefreshToken(response.refreshToken);
      }

      navigate(returnTo ?? "/");
    } catch (err) {
      logger.error("Login failed:", err);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 2,
        minHeight: "var(--full-dvh)",
        boxSizing: "border-box",
      }}
    >
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: 4,
          borderRadius: 2,
          boxShadow: 3,
          maxWidth: 400,
        }}
        aria-labelledby="login-title"
      >
        <LockOutlined
          sx={{ fontSize: 'icon.4xl', color: "#1976d2", marginBottom: 2 }}
          aria-hidden="true"
        />
        <Typography
          id="login-title"
          variant="h5"
          component="h1"
          sx={{ marginBottom: 2 }}
        >
          Login
        </Typography>
        {error ? (
          <Alert
            severity="error"
            sx={{ width: "100%", marginBottom: 2 }}
            role="alert"
          >
            {"Login failed. Please try again."}
          </Alert>
        ) : (
          signOutMessage && (
            <Alert
              severity="info"
              sx={{ width: "100%", marginBottom: 2 }}
              role="status"
            >
              {signOutMessage}
            </Alert>
          )
        )}
        {activeServer && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ marginBottom: 2, textAlign: "center", overflowWrap: "anywhere" }}
          >
            Server: <strong>{activeServer.name}</strong>{" · "}
            <Link
              component="button"
              type="button"
              underline="hover"
              onClick={() => setChangingServer(true)}
              sx={{ verticalAlign: "baseline" }}
            >
              Change server
            </Link>
          </Typography>
        )}
        {browserLogin.available && (
          <>
            <BrowserLoginPanel
              phase={browserLogin.phase}
              error={browserLogin.error}
              onStart={() => void browserLogin.start()}
              onCancel={browserLogin.cancel}
            />
            <Divider flexItem sx={{ marginY: 2 }}>
              <Typography variant="body2" color="text.secondary">
                or use your password
              </Typography>
            </Divider>
          </>
        )}
        <TextField
          id="username"
          label="Username"
          variant="outlined"
          fullWidth
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          sx={{ marginBottom: 2 }}
          required
        />
        <TextField
          id="password"
          label="Password"
          type="password"
          variant="outlined"
          fullWidth
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          sx={{ marginBottom: 2 }}
          required
        />
        <Button
          type="submit"
          variant={browserLogin.available ? "outlined" : "contained"}
          color="primary"
          fullWidth
          disabled={isLoading}
          sx={{ marginBottom: 2 }}
        >
          {isLoading ? <CircularProgress size={24} color="inherit" /> : "Login"}
        </Button>
        {publicSettings?.passwordResetEnabled && (
          <Typography variant="body2" color="textSecondary" sx={{ marginBottom: 1 }}>
            <Link component={RouterLink} underline="hover" to="/forgot-password" aria-label="Forgot password?">
              Forgot password?
            </Link>
          </Typography>
        )}
        <Typography variant="body2" color="textSecondary">
          Don't have an account?{" "}
          <Link component={RouterLink} underline="hover" to="/register" aria-label="Register for an account">
            Register here
          </Link>
        </Typography>
      </Box>
      {changingServer && (
        <ConnectionWizard
          open
          onCancel={() => setChangingServer(false)}
          onComplete={() => {
            // The API client and socket use the active server from startup
            window.location.reload();
          }}
        />
      )}
    </Box>
  );
};

export default LoginPage;
