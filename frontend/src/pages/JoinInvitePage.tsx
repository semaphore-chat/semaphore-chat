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
import { setAccessToken, storeElectronRefreshToken } from "../utils/tokenService";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  inviteControllerGetPublicInviteOptions,
  userControllerRegisterMutation,
  authControllerLoginMutation,
} from "../api-client/@tanstack/react-query.gen";
import { InstanceInvite } from "../types/invite.type";

const FormContainer = styled(Box)({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
  minHeight: "100vh",
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

  const isInviteExpired = (invite: InstanceInvite) => {
    if (!invite?.validUntil) return false;
    return new Date() > new Date(invite.validUntil);
  };

  const isInviteMaxedOut = (invite: InstanceInvite) => {
    if (!invite?.maxUses) return false;
    return invite.uses >= invite.maxUses;
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

  if (inviteError || !invite) {
    return (
      <FormContainer>
        <FormBox>
          <Typography variant="h5" component="h1" sx={{ mb: 2 }}>
            Invalid Invite
          </Typography>
          <Alert severity="error" sx={{ width: "100%", mb: 2 }}>
            This invite link is invalid or has expired.
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

  const expired = isInviteExpired(invite);
  const maxedOut = isInviteMaxedOut(invite);
  const disabled = invite.disabled || expired || maxedOut;

  if (disabled) {
    return (
      <FormContainer>
        <FormBox>
          <Typography variant="h5" component="h1" sx={{ mb: 2 }}>
            Invite Unavailable
          </Typography>
          <Alert severity="error" sx={{ width: "100%", mb: 2 }}>
            {expired && "This invite has expired."}
            {maxedOut && "This invite has reached its maximum number of uses."}
            {invite.disabled && "This invite has been disabled."}
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
          Join Kraken
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
      </FormBox>
    </FormContainer>
  );
};

export default JoinInvitePage;