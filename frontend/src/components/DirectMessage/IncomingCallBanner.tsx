import React from "react";
import { Box, Paper, Avatar, Typography, IconButton, Tooltip } from "@mui/material";
import { Phone, CallEnd } from "@mui/icons-material";
import { useIncomingCall } from "../../contexts/IncomingCallContext";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { logger } from "../../utils/logger";
import { playSound, Sounds } from "../../hooks/useSound";

const pulseKeyframes = {
  "@keyframes incomingCallPulse": {
    "0%": { boxShadow: "0 0 0 0 rgba(76, 175, 80, 0.7)" },
    "50%": { boxShadow: "0 0 0 8px rgba(76, 175, 80, 0)" },
    "100%": { boxShadow: "0 0 0 0 rgba(76, 175, 80, 0)" },
  },
};

export const IncomingCallBanner: React.FC = () => {
  const { incomingCall, dismissCall } = useIncomingCall();
  const { actions } = useVoiceConnection();

  if (!incomingCall) {
    return null;
  }

  const handleAccept = async () => {
    try {
      await actions.joinDmVoice(incomingCall.dmGroupId, incomingCall.dmGroupName);
      dismissCall();
    } catch (error) {
      logger.error("Failed to accept incoming DM voice call:", error);
    }
  };

  const handleDecline = () => {
    playSound(Sounds.callEnded);
    dismissCall();
  };

  return (
    <Paper
      role="alert"
      elevation={8}
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1400,
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: 3,
        py: 1.5,
        borderBottom: "2px solid",
        borderColor: "success.main",
        animation: "incomingCallPulse 2s infinite",
        ...pulseKeyframes,
      }}
    >
      <Avatar
        src={incomingCall.callerAvatar ?? undefined}
        alt={incomingCall.callerName}
        sx={{ width: 40, height: 40 }}
      >
        {incomingCall.callerName.charAt(0).toUpperCase()}
      </Avatar>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" fontWeight="bold" noWrap>
          {incomingCall.callerName}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          Incoming voice call
        </Typography>
      </Box>

      <Box sx={{ display: "flex", gap: 1 }}>
        <Tooltip title="Accept call">
          <IconButton
            onClick={handleAccept}
            sx={{
              backgroundColor: "success.main",
              color: "common.white",
              "&:hover": { backgroundColor: "success.dark" },
            }}
          >
            <Phone />
          </IconButton>
        </Tooltip>
        <Tooltip title="Decline call">
          <IconButton
            onClick={handleDecline}
            sx={{
              backgroundColor: "error.main",
              color: "common.white",
              "&:hover": { backgroundColor: "error.dark" },
            }}
          >
            <CallEnd />
          </IconButton>
        </Tooltip>
      </Box>
    </Paper>
  );
};
