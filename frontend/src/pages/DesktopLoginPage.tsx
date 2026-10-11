import React, { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { DesktopWindowsOutlined } from "@mui/icons-material";
import { authControllerAuthorizeDesktopLoginMutation } from "../api-client/@tanstack/react-query.gen";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useLogout } from "../hooks/useLogout";
import {
  DESKTOP_LOGIN_PATH,
  desktopCallbackUrl,
  desktopCancelUrl,
  parseDesktopLoginParams,
} from "../utils/desktopLogin";
import { logger } from "../utils/logger";

export interface DesktopLoginPageProps {
  /** Sends the browser to the app's loopback listener. A seam for tests and stories. */
  redirect?: (url: string) => void;
  /** Start in another state (stories). */
  initialPhase?: DesktopLoginPhase;
}

/**
 * Replace, not assign: neither the callback URL (with its code) nor this
 * confirm page stays in the browser's history, so Back can't replay either.
 */
const defaultRedirect = (url: string) => window.location.replace(url);

export type DesktopLoginPhase = "confirm" | "handing-over" | "cancelled";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="main"
      sx={{
        minHeight: "var(--full-dvh)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 2,
        boxSizing: "border-box",
      }}
    >
      <Paper
        elevation={3}
        sx={{ width: "100%", maxWidth: 440, padding: { xs: 3, sm: 4 }, borderRadius: 2 }}
      >
        <Stack spacing={2} alignItems="stretch">
          <DesktopWindowsOutlined
            sx={{ fontSize: "icon.4xl", color: "primary.main", alignSelf: "center" }}
            aria-hidden="true"
          />
          {children}
        </Stack>
      </Paper>
    </Box>
  );
}

/**
 * The browser half of "Sign in with browser" for the desktop app (#442).
 * The app opens `/#/desktop-login?challenge=…&state=…&port=…`; AuthGate
 * signs the user in first if needed (with the browser's password manager).
 * Here they confirm signing the app in as themselves; the page then mints a
 * single-use code bound to the app's PKCE challenge and sends the browser to
 * the app's loopback listener with it.
 *
 * Nothing happens without the confirm click: a link someone else sent can't
 * sign anything in on its own, and the code only ever goes to 127.0.0.1.
 */
const DesktopLoginPage: React.FC<DesktopLoginPageProps> = ({
  redirect = defaultRedirect,
  initialPhase = "confirm",
}) => {
  const [searchParams] = useSearchParams();
  const params = useMemo(() => parseDesktopLoginParams(searchParams), [searchParams]);
  const { user, isLoading: userLoading } = useCurrentUser();
  const { handleLogout, logoutLoading } = useLogout();
  const [phase, setPhase] = useState<DesktopLoginPhase>(initialPhase);
  const authorize = useMutation(authControllerAuthorizeDesktopLoginMutation());

  if (!params) {
    return (
      <Card>
        <Typography variant="h5" component="h1" textAlign="center">
          This sign-in link doesn&apos;t work
        </Typography>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          It&apos;s incomplete or damaged. In the Semaphore Chat desktop app, choose
          &ldquo;Sign in with browser&rdquo; again.
        </Typography>
      </Card>
    );
  }

  const approve = async () => {
    try {
      const { code } = await authorize.mutateAsync({
        body: { codeChallenge: params.challenge, codeChallengeMethod: "S256" },
      });
      setPhase("handing-over");
      redirect(desktopCallbackUrl(params, code));
    } catch (err) {
      logger.error("[DesktopLogin] approving the desktop sign-in failed:", err);
    }
  };

  const cancel = () => {
    setPhase("cancelled");
    redirect(desktopCancelUrl(params));
  };

  const notMe = () =>
    void handleLogout({ returnTo: `${DESKTOP_LOGIN_PATH}?${searchParams.toString()}` });

  if (phase === "handing-over") {
    return (
      <Card>
        <Typography variant="h5" component="h1" textAlign="center">
          Return to the desktop app
        </Typography>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          Semaphore Chat is finishing signing you in. If nothing happens, make sure the app
          is still open and try &ldquo;Sign in with browser&rdquo; again.
        </Typography>
      </Card>
    );
  }

  if (phase === "cancelled") {
    return (
      <Card>
        <Typography variant="h5" component="h1" textAlign="center">
          Sign-in cancelled
        </Typography>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          The desktop app wasn&apos;t signed in. You can close this tab.
        </Typography>
      </Card>
    );
  }

  const who = user ? user.displayName || user.username : null;

  return (
    <Card>
      <Typography variant="h5" component="h1" textAlign="center">
        Sign in to the desktop app?
      </Typography>
      {userLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <CircularProgress size={24} aria-label="Loading your account" />
        </Box>
      ) : (
        <Typography variant="body1" textAlign="center" sx={{ overflowWrap: "anywhere" }}>
          The Semaphore Chat app on this computer will be signed in as{" "}
          <strong>{who}</strong>
          {user && user.displayName && user.displayName !== user.username && (
            <> (@{user.username})</>
          )}
          .
        </Typography>
      )}
      <Alert severity="warning" variant="outlined" role="note">
        Only continue if you just chose &ldquo;Sign in with browser&rdquo; in the desktop app
        yourself. Never continue from a link someone sent you.
      </Alert>
      {authorize.isError && (
        <Alert severity="error" role="alert">
          Couldn&apos;t approve the sign-in. Try again, or start over from the desktop app.
        </Alert>
      )}
      <Button
        variant="contained"
        size="large"
        onClick={() => void approve()}
        disabled={authorize.isPending || userLoading || !user}
      >
        {authorize.isPending ? (
          <CircularProgress size={24} color="inherit" aria-label="Signing in" />
        ) : (
          "Sign in to the desktop app"
        )}
      </Button>
      <Button variant="text" onClick={cancel} disabled={authorize.isPending}>
        Cancel
      </Button>
      <Typography variant="body2" color="text.secondary" textAlign="center">
        Not {who ?? "you"}?{" "}
        <Button
          variant="text"
          size="small"
          onClick={notMe}
          disabled={logoutLoading || authorize.isPending}
          sx={{ verticalAlign: "baseline", minWidth: 0, padding: "0 4px" }}
        >
          Sign out and use another account
        </Button>
      </Typography>
    </Card>
  );
};

export default DesktopLoginPage;
