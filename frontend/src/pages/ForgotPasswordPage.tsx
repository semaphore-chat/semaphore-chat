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
import { useMutation } from "@tanstack/react-query";
import { authControllerForgotPasswordMutation } from "../api-client/@tanstack/react-query.gen";
import { Link as RouterLink } from "react-router-dom";

const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const {
    mutateAsync: forgotPassword,
    isPending: isLoading,
    error,
  } = useMutation(authControllerForgotPasswordMutation());

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      await forgotPassword({ body: { email } });
      // Enumeration-safe: the backend always returns the same 200 response
      // whether or not the email matched an account, so we always show the
      // same success copy here too.
      setSubmitted(true);
    } catch (err) {
      // Only reached for network errors / throttling — the backend never
      // fails just because the email doesn't match an account.
      logger.error("Forgot password request failed:", err);
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
        aria-labelledby="forgot-password-title"
      >
        <LockOutlined
          sx={{ fontSize: 40, color: "#1976d2", marginBottom: 2 }}
          aria-hidden="true"
        />
        <Typography
          id="forgot-password-title"
          variant="h5"
          component="h1"
          sx={{ marginBottom: 2 }}
        >
          Forgot Password
        </Typography>
        {submitted ? (
          <>
            <Alert severity="success" sx={{ width: "100%", marginBottom: 2 }}>
              If an account with that email exists, we've sent a reset link.
            </Alert>
            <Typography variant="body2" color="textSecondary">
              <Link component={RouterLink} underline="hover" to="/login" aria-label="Back to login">
                Back to login
              </Link>
            </Typography>
          </>
        ) : (
          <>
            <Typography
              variant="body2"
              color="textSecondary"
              sx={{ marginBottom: 2, textAlign: "center" }}
            >
              Enter your account email and we'll send you a link to reset
              your password.
            </Typography>
            {error && (
              <Alert
                severity="error"
                sx={{ width: "100%", marginBottom: 2 }}
                role="alert"
              >
                Something went wrong. Please try again.
              </Alert>
            )}
            <TextField
              id="email"
              label="Email"
              type="email"
              variant="outlined"
              fullWidth
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              {isLoading ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                "Send reset link"
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

export default ForgotPasswordPage;
