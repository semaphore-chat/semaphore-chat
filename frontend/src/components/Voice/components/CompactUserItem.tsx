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
import { useSpeakingDetection } from "../../../hooks/useSpeakingDetection";
import UserAvatar from "../../Common/UserAvatar";
import { VOLUME_STORAGE_PREFIX } from "../../../constants/voice";
import { deriveUserState } from "./voiceUserState";

interface CompactUserItemProps {
  user: VoicePresenceUserDto;
  isConnectedToThisChannel: boolean;
  localParticipantIdentity?: string;
  onContextMenu: (event: React.MouseEvent<HTMLElement>, user: VoicePresenceUserDto) => void;
  onClickUser: (userId: string) => void;
  onShowVideoTiles: () => void;
}

const CompactUserItem: React.FC<CompactUserItemProps> = React.memo(({
  user,
  isConnectedToThisChannel,
  localParticipantIdentity,
  onContextMenu,
  onClickUser,
  onShowVideoTiles,
}) => {
  const theme = useTheme();
  const { isSpeaking } = useSpeakingDetection();
  const speaking = isSpeaking(user.id);
  const livekitState = useParticipantTracks(user.id);
  const userState = deriveUserState(livekitState, user);

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
      sx={{
        px: 1,
        py: 0.5,
        pl: 4,
        minHeight: 40,
        cursor: "pointer",
        "&:hover": {
          backgroundColor: theme.palette.semantic.overlay.light,
        },
      }}
      onClick={() => onClickUser(user.id)}
      onContextMenu={(e) => onContextMenu(e, user)}
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
            <UserAvatar user={user} size="small" />
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
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography
              variant="body2"
              sx={{
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
                <Tooltip title={isConnectedToThisChannel ? "View camera" : "Camera"}>
                  {isConnectedToThisChannel ? (
                    <IconButton
                      size="small"
                      aria-label="View camera"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowVideoTiles();
                      }}
                      sx={{ p: 0.25 }}
                    >
                      <Videocam sx={{ fontSize: 16, color: theme.palette.semantic.status.positive }} />
                    </IconButton>
                  ) : (
                    <Videocam sx={{ fontSize: 16, color: theme.palette.semantic.status.positive }} />
                  )}
                </Tooltip>
              )}

              {userState.isScreenSharing && (
                <Tooltip title={isConnectedToThisChannel ? "View screen share" : "Screen Share"}>
                  {isConnectedToThisChannel ? (
                    <IconButton
                      size="small"
                      aria-label="View screen share"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowVideoTiles();
                      }}
                      sx={{ p: 0.25 }}
                    >
                      <ScreenShare sx={{ fontSize: 16, color: theme.palette.primary.main }} />
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
