import React, { useEffect, useState } from "react";
import { logger } from "../utils/logger";
import {
  Box,
  Button,
  TextField,
  Typography,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  Divider,
} from "@mui/material";
import { styled } from "@mui/system";
import { useParams, useNavigate } from "react-router-dom";
import {
  getAccessToken,
  refreshSession,
  setAccessToken,
  storeElectronRefreshToken,
} from "../utils/tokenService";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  inviteControllerGetPublicInviteOptions,
  inviteControllerAcceptInviteMutation,
  userControllerRegisterMutation,
  authControllerLoginMutation,
} from "../api-client/@tanstack/react-query.gen";
import { ErrorCode } from "@semaphore-chat/shared";

/** Why the server refused an invite code, for the join screen. */
function inviteFailureMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "errorCode" in error
      ? error.errorCode
      : undefined;
  switch (code) {
    case ErrorCode.INVITE_EXPIRED:
      return "This invite has expired.";
    case ErrorCode.INVITE_EXHAUSTED:
      return "This invite has reached its maximum number of uses.";
    case ErrorCode.INVITE_DISABLED:
      return "This invite has been disabled.";
    default:
      return "This invite link is invalid or has expired.";
  }
}

const FormContainer = styled(Box)({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
  minHeight: "var(--full-dvh)",
});

const FormBox = styled(Box)({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "32px",
  borderRadius: "8px",
  boxShadow: "0px 4px 10px rgba(0, 0, 0, 0.1)",
  width: "100%",
  maxWidth: "500px",
});

const JoinInvitePage: React.FC = () => {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const {
    data: invite,
    isLoading: loadingInvite,
    error: inviteError,
  } = useQuery({
    ...inviteControllerGetPublicInviteOptions({ path: { code: inviteCode || "" } }),
    enabled: !!inviteCode,
  });

  const { mutateAsync: register, isPending: registering, error: registerError } = useMutation(userControllerRegisterMutation());
  const { mutateAsync: login, isPending: loggingIn } = useMutation(authControllerLoginMutation());
  const {
    mutateAsync: acceptInvite,
    isPending: accepting,
    error: acceptError,
  } = useMutation(inviteControllerAcceptInviteMutation());

  // A session may exist from an earlier page (token in memory) or from the
  // refresh cookie after opening the link directly: ask once, quietly.
  const [signedIn, setSignedIn] = useState(() => !!getAccessToken());

  useEffect(() => {
    if (signedIn) return;
    let cancelled = false;
    refreshSession().then((result) => {
      if (!cancelled && result.status === "refreshed") setSignedIn(true);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  useEffect(() => {
    if (!inviteCode) {
      navigate("/");
    }
  }, [inviteCode, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode) return;

    try {
      await register({ body: { username, email, password, code: inviteCode } });

      const response = await login({ body: { username, password } });
      setAccessToken(response.accessToken);
      if (response.refreshToken) {
        await storeElectronRefreshToken(response.refreshToken);
      }
      navigate("/");
    } catch (err) {
      logger.error("Registration failed:", err);
    }
  };

  const handleJoinWithAccount = async () => {
    if (!inviteCode) return;
    try {
      const result = await acceptInvite({ path: { code: inviteCode } });
      const firstJoined = result.joined[0];
      navigate(firstJoined ? `/community/${firstJoined.id}` : "/");
    } catch (err) {
      logger.error("Joining with the account failed:", err);
    }
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loadingInvite) {
    return (
      <FormContainer>
        <Box display="flex" flexDirection="column" alignItems="center" gap={2}>
          <CircularProgress />
          <Typography>Validating invite...</Typography>
        </Box>
      </FormContainer>
    );
  }

  // The lookup answers 404 with a reason for a code that can't be used.
  if (inviteError || !invite?.code) {
    return (
      <FormContainer>
        <FormBox>
          <Typography variant="h5" component="h1" sx={{ mb: 2 }}>
            Invalid Invite
          </Typography>
          <Alert severity="error" sx={{ width: "100%", mb: 2 }}>
            {inviteFailureMessage(inviteError)}
          </Alert>
          <Button
            variant="contained"
            onClick={() => navigate("/")}
            fullWidth
          >
            Go to Home
          </Button>
        </FormBox>
      </FormContainer>
    );
  }

  return (
    <FormContainer>
      <FormBox>
        <Typography variant="h4" component="h1" sx={{ mb: 1 }}>
          Join Semaphore Chat
        </Typography>
        
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: "center" }}>
          You've been invited to join this community
        </Typography>

        {/* Invite Details Card */}
        <Card sx={{ width: "100%", mb: 3, bgcolor: "background.default" }}>
          <CardContent sx={{ py: 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="subtitle2" color="text.secondary">
                Invite Code
              </Typography>
              <Typography variant="body2" fontFamily="monospace" fontWeight="medium">
                {invite.code}
              </Typography>
            </Box>
            
            <Divider sx={{ my: 1 }} />
            
            <Box display="flex" flexDirection="column" gap={0.5}>
              {invite.createdBy && (
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary">
                    Created by
                  </Typography>
                  <Typography variant="caption">
                    {invite.createdBy.username}
                  </Typography>
                </Box>
              )}
              
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Typography variant="caption" color="text.secondary">
                  Uses
                </Typography>
                <Typography variant="caption">
                  {invite.uses}{invite.maxUses && `/${invite.maxUses}`}
                </Typography>
              </Box>
              
              {invite.validUntil && (
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary">
                    Expires
                  </Typography>
                  <Typography variant="caption">
                    {formatDate(invite.validUntil)}
                  </Typography>
                </Box>
              )}
            </Box>
          </CardContent>
        </Card>

        {signedIn ? (
          /* Signed in: join with the existing account instead of registering */
          <Box sx={{ width: "100%" }}>
            {acceptError && (
              <Alert severity="error" sx={{ width: "100%", mb: 2 }}>
                {inviteFailureMessage(acceptError)}
              </Alert>
            )}
            <Button
              variant="contained"
              color="primary"
              fullWidth
              onClick={handleJoinWithAccount}
              disabled={accepting}
              sx={{ mb: 2 }}
            >
              {accepting ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                "Join with your account"
              )}
            </Button>
          </Box>
        ) : (
          <>
            {/* Registration Form */}
            <Box
              component="form"
              onSubmit={handleSubmit}
              sx={{ width: "100%" }}
            >
              {registerError && (
                <Alert
                  severity="error"
                  sx={{ width: "100%", mb: 2 }}
                >
                  Registration failed. Please try again.
                </Alert>
              )}
              
              <TextField
                label="Username"
                variant="outlined"
                fullWidth
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                sx={{ mb: 2 }}
                required
              />
              
              <TextField
                label="Email"
                type="email"
                variant="outlined"
                fullWidth
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                sx={{ mb: 2 }}
                required
              />
              
              <TextField
                label="Password"
                type="password"
                variant="outlined"
                fullWidth
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                sx={{ mb: 3 }}
                required
              />
              
              <Button
                type="submit"
                variant="contained"
                color="primary"
                fullWidth
                disabled={registering || loggingIn}
                sx={{ mb: 2 }}
              >
                {registering || loggingIn ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  "Join Community"
                )}
              </Button>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
              Already have an account?{" "}
              <Button
                variant="text"
                size="small"
                onClick={() => navigate("/login")}
                sx={{ textTransform: "none", p: 0, minWidth: "auto" }}
              >
                Login here
              </Button>
            </Typography>
          </>
        )}
      </FormBox>
    </FormContainer>
  );
};

export default JoinInvitePage;