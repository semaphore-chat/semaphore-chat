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
} from "@mui/material";
import { LockOutlined } from "@mui/icons-material";
import { useMutation } from "@tanstack/react-query";
import { authControllerResetPasswordMutation } from "../api-client/@tanstack/react-query.gen";
import { useNavigate, useSearchParams, Link as RouterLink } from "react-router-dom";

const getErrorMessage = (err: unknown): string => {
  const msg = (err as Record<string, unknown>)?.message;
  if (Array.isArray(msg)) return msg.join(", ");
  if (typeof msg === "string") return msg;
  return "Failed to reset password. Please try again.";
};

const ResetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [success, setSuccess] = useState(false);

  const {
    mutateAsync: resetPassword,
    isPending: isLoading,
    error,
  } = useMutation(authControllerResetPasswordMutation());

  // Mirror the backend DTO rule (8-128 chars) so the submit button state
  // matches what the API will accept
  const tooShort = password.length > 0 && password.length < 8;
  const tooLong = password.length > 128;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    !!token &&
    password.length >= 8 &&
    !tooLong &&
    password === confirm &&
    !isLoading &&
    !success;

  useEffect(() => {
    if (success) {
      const timeout = setTimeout(() => navigate("/login"), 2000);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [success, navigate]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      await resetPassword({ body: { token, newPassword: password } });
      setSuccess(true);
    } catch (err) {
      logger.error("Reset password failed:", err);
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
        aria-labelledby="reset-password-title"
      >
        <LockOutlined
          sx={{ fontSize: 40, color: "#1976d2", marginBottom: 2 }}
          aria-hidden="true"
        />
        <Typography
          id="reset-password-title"
          variant="h5"
          component="h1"
          sx={{ marginBottom: 2 }}
        >
          Reset Password
        </Typography>

        {!token ? (
          <>
            <Alert severity="error" sx={{ width: "100%", marginBottom: 2 }}>
              This reset link is missing or invalid.
            </Alert>
            <Typography variant="body2" color="textSecondary">
              <Link component={RouterLink} underline="hover" to="/forgot-password" aria-label="Request a new reset link">
                Request a new reset link
              </Link>
            </Typography>
          </>
        ) : success ? (
          <Alert severity="success" sx={{ width: "100%" }}>
            Password has been reset. Redirecting to login&hellip;
          </Alert>
        ) : (
          <>
            {error && (
              <>
                <Alert
                  severity="error"
                  sx={{ width: "100%", marginBottom: 2 }}
                  role="alert"
                >
                  {getErrorMessage(error)}
                </Alert>
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{ marginBottom: 2 }}
                >
                  <Link component={RouterLink} underline="hover"
                    to="/forgot-password"
                    aria-label="Request a new reset link"
                  >
                    Request a new reset link
                  </Link>
                </Typography>
              </>
            )}
            <TextField
              id="password"
              label="New password"
              type="password"
              variant="outlined"
              fullWidth
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              sx={{ marginBottom: 2 }}
              required
              autoComplete="new-password"
              error={tooShort || tooLong}
              helperText={
                tooShort
                  ? "Must be at least 8 characters"
                  : tooLong
                    ? "Must be at most 128 characters"
                    : " "
              }
              inputProps={{ maxLength: 128 }}
            />
            <TextField
              id="confirm-password"
              label="Confirm new password"
              type="password"
              variant="outlined"
              fullWidth
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              sx={{ marginBottom: 2 }}
              required
              autoComplete="new-password"
              error={mismatch}
              helperText={mismatch ? "Passwords do not match" : " "}
              inputProps={{ maxLength: 128 }}
            />
            <Button
              type="submit"
              variant="contained"
              color="primary"
              fullWidth
              disabled={!canSubmit}
              sx={{ marginBottom: 2 }}
            >
              {isLoading ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                "Reset Password"
              )}
            </Button>
            <Typography variant="body2" color="textSecondary">
              <Link component={RouterLink} underline="hover" to="/login" aria-label="Back to login">
                Back to login
              </Link>
            </Typography>
          </>
        )}
      </Box>
    </Box>
  );
};

export default ResetPasswordPage;
