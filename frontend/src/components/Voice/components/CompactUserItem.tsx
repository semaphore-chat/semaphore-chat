import React from "react";
import {
  Box,
  Typography,
  Tooltip,
  ListItem,
  ListItemAvatar,
  ListItemText,
  IconButton,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  MicOff,
  Videocam,
  ScreenShare,
  VolumeOff,
} from "@mui/icons-material";
import type { VoicePresenceUserDto } from "../../../api-client/types.gen";
import { useParticipantTracks } from "../../../hooks/useParticipantTracks";
import UserAvatar from "../../Common/UserAvatar";
import { VOLUME_STORAGE_PREFIX } from "../../../constants/voice";
import { deriveUserState } from "./voiceUserState";
import { useResponsive } from "../../../hooks/useResponsive";
import { useLongPress } from "../../../hooks/useSwipeGesture";

interface CompactUserItemProps {
  user: VoicePresenceUserDto;
  isConnectedToThisChannel: boolean;
  localParticipantIdentity?: string;
  isSpeaking: (userId: string) => boolean;
  onContextMenu: (event: React.MouseEvent<HTMLElement>, user: VoicePresenceUserDto) => void;
  onClickUser: (userId: string) => void;
  onShowVideoTiles: () => void;
  isWatchingCamera?: boolean;
  isWatchingScreenShare?: boolean;
  onWatchCamera?: (userId: string) => void;
  onStopWatchingCamera?: (userId: string) => void;
  onWatchScreenShare?: (userId: string) => void;
  onStopWatchingScreenShare?: (userId: string) => void;
}

const CompactUserItem: React.FC<CompactUserItemProps> = React.memo(({
  user,
  isConnectedToThisChannel,
  localParticipantIdentity,
  isSpeaking,
  onContextMenu,
  onClickUser,
  onShowVideoTiles,
  isWatchingCamera,
  isWatchingScreenShare,
  onWatchCamera,
  onStopWatchingCamera,
  onWatchScreenShare,
  onStopWatchingScreenShare,
}) => {
  const theme = useTheme();
  const livekitState = useParticipantTracks(user.id);
  const userState = deriveUserState(livekitState, user);
  const speaking = isSpeaking(user.id) && !userState.isMuted && !userState.isServerMuted && !userState.isDeafened;
  const { shouldUseTouchUI } = useResponsive();

  const longPress = useLongPress(
    (point) => {
      if (point) {
        onContextMenu(
          { preventDefault: () => {}, clientX: point.x, clientY: point.y } as React.MouseEvent<HTMLElement>,
          user,
        );
      }
    },
    { enabled: shouldUseTouchUI },
  );

  const interactionProps = shouldUseTouchUI
    ? {
        onTouchStart: longPress.onTouchStart,
        onTouchMove: longPress.onTouchMove,
        onTouchEnd: longPress.onTouchEnd,
        onTouchCancel: longPress.onTouchCancel,
        onContextMenu: longPress.onContextMenu,
      }
    : { onContextMenu: (e: React.MouseEvent<HTMLElement>) => onContextMenu(e, user) };

  // Check if locally muted (volume = 0 in localStorage)
  const isLocalUser = localParticipantIdentity === user.id;
  const isLocallyMuted = !isLocalUser && (() => {
    try {
      const stored = localStorage.getItem(`${VOLUME_STORAGE_PREFIX}${user.id}`);
      return stored !== null && parseFloat(stored) === 0;
    } catch { return false; }
  })();

  return (
    <ListItem
      // Not in tab order (-1) — only focused programmatically, to restore
      // focus here after the right-click/long-press context menu closes.
      tabIndex={-1}
      sx={{
        px: 1,
        py: 0.5,
        pl: 4,
        minHeight: 40,
        cursor: "pointer",
       ...(shouldUseTouchUI && {
         WebkitTouchCallout: "none",
         userSelect: "none",
       }),
        "&:hover": {
          backgroundColor: theme.palette.semantic.overlay.light,
        },
      }}
      onClick={() => {
        // Ignore the post-long-press ghost click (iOS) so the profile
        // doesn't open on top of the moderation menu.
        if (longPress.isLongPressTriggered()) return;
        onClickUser(user.id);
      }}
      {...interactionProps}
    >
      <ListItemAvatar sx={{ minWidth: 40 }}>
        <Box sx={{ position: "relative", display: "flex", alignItems: "center" }}>
          <Box
            sx={{
              border: speaking ? `2px solid ${theme.palette.semantic.status.positive}` : "2px solid transparent",
              transition: "border-color 0.2s ease",
              borderRadius: "50%",
            }}
          >
            <UserAvatar userId={user.id} size="small" />
          </Box>

          {/* Audio status badge (deafen > server mute > self mute) */}
          {userState.isDeafened ? (
            <Box
              sx={{
                position: "absolute",
                bottom: -2,
                right: -2,
                backgroundColor: theme.palette.semantic.status.negative,
                borderRadius: "50%",
                width: 16,
                height: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid",
                borderColor: "background.paper",
              }}
            >
              <VolumeOff sx={{ fontSize: 10, color: "white" }} />
            </Box>
          ) : userState.isServerMuted ? (
            <Box
              sx={{
                position: "absolute",
                bottom: -2,
                right: -2,
                backgroundColor: "warning.main",
                borderRadius: "50%",
                width: 16,
                height: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid",
                borderColor: "background.paper",
              }}
            >
              <MicOff sx={{ fontSize: 10, color: "white" }} />
            </Box>
          ) : userState.isMuted ? (
            <Box
              sx={{
                position: "absolute",
                bottom: -2,
                right: -2,
                backgroundColor: theme.palette.semantic.status.negative,
                borderRadius: "50%",
                width: 16,
                height: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid",
                borderColor: "background.paper",
              }}
            >
              <MicOff sx={{ fontSize: 10, color: "white" }} />
            </Box>
          ) : null}
        </Box>
      </ListItemAvatar>

      <ListItemText
        primary={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <Typography
              variant="body2"
              noWrap
              sx={{
                minWidth: 0,
                fontWeight: 500,
                color: userState.isMuted ? "text.secondary" : "text.primary",
                fontSize: "14px"
              }}
            >
              {user.displayName || user.username}
            </Typography>

            {/* Status indicators */}
            <Box sx={{ display: "flex", gap: 0.5, ml: "auto", alignItems: "center" }}>
              {userState.isDeafened ? (
                <Tooltip title="Deafened">
                  <VolumeOff sx={{ fontSize: 16, color: theme.palette.semantic.status.negative }} />
                </Tooltip>
              ) : userState.isServerMuted ? (
                <Tooltip title="Server Muted">
                  <MicOff sx={{ fontSize: 16, color: "warning.main" }} />
                </Tooltip>
              ) : userState.isMuted ? (
                <Tooltip title="Muted">
                  <MicOff sx={{ fontSize: 16, color: theme.palette.semantic.status.negative }} />
                </Tooltip>
              ) : null}

              {isLocallyMuted && (
                <Tooltip title="Muted for you">
                  <VolumeOff sx={{ fontSize: 16, color: "text.disabled" }} />
                </Tooltip>
              )}

              {userState.isVideoEnabled && (
                <Tooltip title={
                  !isConnectedToThisChannel ? "Camera" :
                  isWatchingCamera ? "Stop watching camera" : "Watch camera"
                }>
                  {isConnectedToThisChannel ? (
                    <IconButton
                      size="small"
                      aria-label={isWatchingCamera ? "Stop watching camera" : "Watch camera"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isWatchingCamera && onStopWatchingCamera) {
                          onStopWatchingCamera(user.id);
                        } else if (onWatchCamera) {
                          onWatchCamera(user.id);
                          onShowVideoTiles();
                        } else {
                          onShowVideoTiles();
                        }
                      }}
                      sx={{ p: 0.25 }}
                    >
                      <Videocam sx={{
                        fontSize: 16,
                        color: isWatchingCamera
                          ? theme.palette.semantic.status.positive
                          : theme.palette.text.secondary,
                      }} />
                    </IconButton>
                  ) : (
                    <Videocam sx={{ fontSize: 16, color: theme.palette.semantic.status.positive }} />
                  )}
                </Tooltip>
              )}

              {userState.isScreenSharing && (
                <Tooltip title={
                  !isConnectedToThisChannel ? "Screen Share" :
                  isWatchingScreenShare ? "Stop watching screen share" : "Watch screen share"
                }>
                  {isConnectedToThisChannel ? (
                    <IconButton
                      size="small"
                      aria-label={isWatchingScreenShare ? "Stop watching screen share" : "Watch screen share"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isWatchingScreenShare && onStopWatchingScreenShare) {
                          onStopWatchingScreenShare(user.id);
                        } else if (onWatchScreenShare) {
                          onWatchScreenShare(user.id);
                          onShowVideoTiles();
                        } else {
                          onShowVideoTiles();
                        }
                      }}
                      sx={{ p: 0.25 }}
                    >
                      <ScreenShare sx={{
                        fontSize: 16,
                        color: isWatchingScreenShare
                          ? theme.palette.primary.main
                          : theme.palette.text.secondary,
                      }} />
                    </IconButton>
                  ) : (
                    <ScreenShare sx={{ fontSize: 16, color: theme.palette.primary.main }} />
                  )}
                </Tooltip>
              )}
            </Box>
          </Box>
        }
      />
    </ListItem>
  );
});

export default CompactUserItem;
