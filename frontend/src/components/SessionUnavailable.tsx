import { Box, Button, Stack, Typography } from "@mui/material";
import { CloudOffOutlined } from "@mui/icons-material";
import { TOUCH_TARGETS } from "../utils/breakpoints";

export interface SessionUnavailableProps {
  /** Try to restore the session again now. */
  onRetry: () => void;
  /** Forget the stored session and go to the login page. */
  onSignIn: () => void;
}

/**
 * What a page load shows when it couldn't restore the session because the
 * server kept failing (network errors, 5xx, 429) through several rounds of
 * retries (AuthGate). The session may well be fine, so it doesn't sign out
 * on its own: the user can try again, or sign in again.
 */
export function SessionUnavailable({ onRetry, onSignIn }: SessionUnavailableProps) {
  return (
    <Box
      role="alert"
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "var(--full-dvh)",
        gap: 2,
        px: 2,
        textAlign: "center",
      }}
    >
      <CloudOffOutlined sx={{ fontSize: 48, color: "text.secondary" }} />
      <Typography variant="h6" component="h1">
        Can't reach the server
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
        Your session couldn't be restored because the server isn't answering.
        Try again in a moment, or sign in again.
      </Typography>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ width: { xs: "100%", sm: "auto" }, maxWidth: 360 }}
      >
        <Button
          variant="contained"
          onClick={onRetry}
          sx={{ minHeight: TOUCH_TARGETS.MINIMUM }}
        >
          Try again
        </Button>
        <Button
          variant="outlined"
          onClick={onSignIn}
          sx={{ minHeight: TOUCH_TARGETS.MINIMUM }}
        >
          Sign in again
        </Button>
      </Stack>
    </Box>
  );
}

export default SessionUnavailable;
