import React, { useState } from "react";
import { logger } from "../utils/logger";
import {
  Box,
  Button,
  TextField,
  Typography,
  CircularProgress,
  Alert,
  Link,
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

/** Router state AuthGate passes when the server signed the user out. */
export interface LoginLocationState {
  signOutReason?: SignOutReason;
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
  const signOutReason = (useLocation().state as LoginLocationState | null)
    ?.signOutReason;
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

      navigate("/");
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
          sx={{ fontSize: 40, color: "#1976d2", marginBottom: 2 }}
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
          variant="contained"
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
    </Box>
  );
};

export default LoginPage;
