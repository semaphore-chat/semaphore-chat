import React from "react";
import { Box, Paper, Avatar, Typography, IconButton, Tooltip } from "@mui/material";
import { Phone, CallEnd } from "@mui/icons-material";
import { useIncomingCall } from "../../contexts/IncomingCallContext";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { logger } from "../../utils/logger";
import { playSound, Sounds } from "../../hooks/useSound";
import { AuthenticatedImage } from "../Common/AuthenticatedImage";
import {
  TOP_CHROME_ORDER,
  useHasTopChromeHost,
  useMeasuredChromeItem,
  useTopChromeOffset,
} from "../../contexts/BottomChromeContext";
import { TOUCH_TARGETS } from "../../utils/breakpoints";

const pulseKeyframes = {
  "@keyframes incomingCallPulse": {
    "0%": { boxShadow: "0 0 0 0 rgba(76, 175, 80, 0.7)" },
    "50%": { boxShadow: "0 0 0 8px rgba(76, 175, 80, 0)" },
    "100%": { boxShadow: "0 0 0 0 rgba(76, 175, 80, 0)" },
  },
};

/**
 * Incoming DM call banner: a full-width strip at the top of the window that
 * registers as top chrome (see BottomChromeContext), so the layout pushes its
 * content down instead of the banner covering it. On phone/tablet that's the
 * app bar (below the offline strip if that's showing); on desktop and in
 * Electron, which have no app bar, it's the page header and the rail, whose
 * controls (e.g. a DM's "Start voice call") must stay clickable while it rings.
 * Touch-sized buttons only on the phone/tablet layouts.
 */
export const IncomingCallBanner: React.FC = () => {
  const { incomingCall, dismissCall } = useIncomingCall();
  const { actions } = useVoiceConnection();
  const touchLayout = useHasTopChromeHost();
  const top = useTopChromeOffset(TOP_CHROME_ORDER.INCOMING_CALL);
  const measureRef = useMeasuredChromeItem({
    id: "incoming-call",
    edge: "top",
    order: TOP_CHROME_ORDER.INCOMING_CALL,
    fallbackHeight: 64,
    enabled: !!incomingCall,
  });
  const buttonSize = touchLayout ? { minWidth: TOUCH_TARGETS.MINIMUM, minHeight: TOUCH_TARGETS.MINIMUM } : {};

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
      ref={measureRef}
      role="alert"
      elevation={8}
      sx={{
        position: "fixed",
        top: top.css,
        left: 0,
        right: 0,
        zIndex: 1400,
        borderRadius: 0,
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: touchLayout ? 2 : 3,
        py: 1.5,
        borderBottom: "2px solid",
        borderColor: "success.main",
        animation: "incomingCallPulse 2s infinite",
        ...pulseKeyframes,
      }}
    >
      {/* callerAvatar is a file id — resolve it through the authenticated file cache */}
      <AuthenticatedImage
        fileId={incomingCall.callerAvatar}
        alt={incomingCall.callerName}
        component="avatar"
        sx={{ width: 40, height: 40, flexShrink: 0 }}
        fallback={
          <Avatar alt={incomingCall.callerName} sx={{ width: 40, height: 40, flexShrink: 0 }}>
            {incomingCall.callerName.charAt(0).toUpperCase()}
          </Avatar>
        }
      />

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
              ...buttonSize,
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
              ...buttonSize,
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
