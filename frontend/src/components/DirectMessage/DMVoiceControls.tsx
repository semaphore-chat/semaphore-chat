import React, { useState } from "react";
import { Box, IconButton, Tooltip, CircularProgress, Chip } from "@mui/material";
import { Phone, Videocam } from "@mui/icons-material";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { logger } from "../../utils/logger";

interface DMVoiceControlsProps {
  dmGroupId: string;
  dmGroupName: string;
}

export const DMVoiceControls: React.FC<DMVoiceControlsProps> = ({
  dmGroupId,
  dmGroupName,
}) => {
  const { state, actions } = useVoiceConnection();
  const [isJoining, setIsJoining] = useState(false);

  // Check if we're currently in this DM's voice call
  const isInThisDmCall =
    state.isConnected &&
    state.contextType === "dm" &&
    state.currentDmGroupId === dmGroupId;

  // Check if we're in any voice call (DM or channel)
  const isInAnyCall = state.isConnected;

  const handleStartVoiceCall = async () => {
    if (isInAnyCall) {
      // If already in a call, leave it first
      if (state.contextType === "dm") {
        await actions.leaveVoiceChannel();
      }
      // Don't handle channel calls here - let the user manually leave
      return;
    }

    setIsJoining(true);
    try {
      await actions.joinDmVoice(dmGroupId, dmGroupName);
    } catch (error) {
      logger.error("Failed to join DM voice call:", error);
    } finally {
      setIsJoining(false);
    }
  };

  const handleStartVideoCall = async () => {
    if (isInAnyCall) {
      // If already in a call, leave it first
      if (state.contextType === "dm") {
        await actions.leaveVoiceChannel();
      }
      return;
    }

    setIsJoining(true);
    try {
      // Join with audio first, then enable video
      await actions.joinDmVoice(dmGroupId, dmGroupName);
      await actions.toggleVideo();
      actions.setShowVideoTiles(true);
    } catch (error) {
      logger.error("Failed to start DM video call:", error);
    } finally {
      setIsJoining(false);
    }
  };

  // If in this DM call, show active indicator (controls are in bottom bar)
  if (isInThisDmCall) {
    return (
      <Chip
        icon={<Phone />}
        label="In Call"
        color="success"
        size="small"
      />
    );
  }

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      {/* Voice Call Button */}
      <Tooltip
        title={
          isInAnyCall
            ? "Leave current call first"
            : "Start voice call"
        }
      >
        <span>
          <IconButton
            size="small"
            onClick={handleStartVoiceCall}
            disabled={isJoining || (isInAnyCall && !isInThisDmCall)}
            sx={{
              color: "text.secondary",
              "&:hover": {
                color: "primary.main",
                backgroundColor: "action.hover",
              },
            }}
          >
            {isJoining ? <CircularProgress size={20} /> : <Phone />}
          </IconButton>
        </span>
      </Tooltip>

      {/* Video Call Button */}
      <Tooltip
        title={
          isInAnyCall
            ? "Leave current call first"
            : "Start video call"
        }
      >
        <span>
          <IconButton
            size="small"
            onClick={handleStartVideoCall}
            disabled={isJoining || (isInAnyCall && !isInThisDmCall)}
            sx={{
              color: "text.secondary",
              "&:hover": {
                color: "primary.main",
                backgroundColor: "action.hover",
              },
            }}
          >
            {isJoining ? <CircularProgress size={20} /> : <Videocam />}
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
};
