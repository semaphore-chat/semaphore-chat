import React from "react";
import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";
import { OpenInBrowser } from "@mui/icons-material";
import type { BrowserLoginError, BrowserLoginPhase } from "../../hooks/useBrowserLogin";

const ERROR_MESSAGES: Record<BrowserLoginError, string> = {
  denied: "Sign-in was cancelled in the browser.",
  timeout: "The browser didn't finish signing in in time. Try again.",
  failed: "Couldn't sign in through the browser. Try again.",
};

export interface BrowserLoginPanelProps {
  phase: BrowserLoginPhase;
  error: BrowserLoginError | null;
  onStart: () => void;
  onCancel: () => void;
}

/**
 * The desktop login screen's primary action: sign in through the system
 * browser (and its password manager), then wait for it to come back.
 */
export const BrowserLoginPanel: React.FC<BrowserLoginPanelProps> = ({
  phase,
  error,
  onStart,
  onCancel,
}) => {
  if (phase !== "idle") {
    const signingIn = phase === "signing-in";
    return (
      <Box
        role="status"
        aria-live="polite"
        sx={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1.5,
          py: 1,
          textAlign: "center",
        }}
      >
        <CircularProgress size={28} aria-hidden="true" />
        <Typography variant="subtitle1" component="p">
          {signingIn ? "Signing you in…" : "Waiting for your browser…"}
        </Typography>
        {!signingIn && (
          <>
            <Typography variant="body2" color="text.secondary">
              Finish signing in in the browser window that opened, then come back here.
            </Typography>
            <Button variant="text" onClick={onCancel}>
              Cancel
            </Button>
          </>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ width: "100%", display: "flex", flexDirection: "column", gap: 1 }}>
      {error && (
        <Alert severity={error === "denied" ? "info" : "error"} role="alert">
          {ERROR_MESSAGES[error]}
        </Alert>
      )}
      <Button
        variant="contained"
        size="large"
        fullWidth
        startIcon={<OpenInBrowser />}
        onClick={onStart}
      >
        Sign in with browser
      </Button>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
        Opens your browser, so you can use its password manager or the session you already have.
      </Typography>
    </Box>
  );
};

export default BrowserLoginPanel;
