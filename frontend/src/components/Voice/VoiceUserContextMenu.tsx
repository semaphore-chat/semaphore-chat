import React, { useState, useCallback } from "react";
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Slider,
  Box,
  Typography,
} from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import MicOffIcon from "@mui/icons-material/MicOff";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import TimerIcon from "@mui/icons-material/Timer";
import BlockIcon from "@mui/icons-material/Block";
import { useCanPerformAction } from "../../features/roles/useUserPermissions";
import { RBAC_ACTIONS } from "../../constants/rbacActions";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { useParticipantTracks } from "../../hooks/useParticipantTracks";
import { TRACK_SOURCE } from "../../features/voice/livekitEvents";
import BanDialog from "../Moderation/BanDialog";
import TimeoutDialog from "../Moderation/TimeoutDialog";
import KickConfirmDialog from "../Moderation/KickConfirmDialog";
import { livekitControllerMuteParticipant } from "../../api-client/sdk.gen";
import { useNotification } from "../../contexts/NotificationContext";
import type { VoicePresenceUserDto } from "../../api-client/types.gen";
import { VOLUME_STORAGE_PREFIX } from "../../constants/voice";
import { audioBoostManager, boostKey } from "../../features/voice/audioBoostManager";
import { isBoostableAudioTrack } from "../../features/voice/isBoostableAudioTrack";
import { logger } from "../../utils/logger";

function getStoredVolume(userId: string): number | null {
  try {
    const stored = localStorage.getItem(`${VOLUME_STORAGE_PREFIX}${userId}`);
    return stored !== null ? parseFloat(stored) : null;
  } catch {
    return null;
  }
}

function setStoredVolume(userId: string, volume: number): void {
  try {
    localStorage.setItem(`${VOLUME_STORAGE_PREFIX}${userId}`, String(volume));
  } catch {
    // ignore storage errors
  }
}

interface VoiceUserContextMenuProps {
  anchorPosition: { top: number; left: number } | null;
  open: boolean;
  onClose: () => void;
  user: VoicePresenceUserDto;
  communityId?: string;
  onViewProfile: () => void;
}

const VoiceUserContextMenu: React.FC<VoiceUserContextMenuProps> = ({
  anchorPosition,
  open,
  onClose,
  user,
  communityId,
  onViewProfile,
}) => {
  const { state: voiceState } = useVoiceConnection();
  const { participant } = useParticipantTracks(user.id);
  const isLocalUser = voiceState.room?.localParticipant?.identity === user.id;
  const { showNotification } = useNotification();

  // Volume state (0-200, stored as 0-2.0)
  const [volume, setVolume] = useState<number>(() => {
    const stored = getStoredVolume(user.id);
    return stored !== null ? Math.round(stored * 100) : 100;
  });
  const [previousVolume, setPreviousVolume] = useState<number>(100);
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [timeoutDialogOpen, setTimeoutDialogOpen] = useState(false);
  const [kickDialogOpen, setKickDialogOpen] = useState(false);

  const isLocallyMuted = volume === 0;

  const canMuteParticipant = useCanPerformAction(
    "COMMUNITY",
    communityId,
    RBAC_ACTIONS.MUTE_PARTICIPANT,
  );
  const canKick = useCanPerformAction(
    "COMMUNITY",
    communityId,
    RBAC_ACTIONS.KICK_USER,
  );
  const canTimeout = useCanPerformAction(
    "COMMUNITY",
    communityId,
    RBAC_ACTIONS.TIMEOUT_USER,
  );
  const canBan = useCanPerformAction(
    "COMMUNITY",
    communityId,
    RBAC_ACTIONS.BAN_USER,
  );

  // Forward live slider changes to the app-wide boost manager. The manager
  // owns the GainNode wiring for >100% volumes, so the audible path survives
  // this menu unmounting; useRemoteVolumeEffect re-applies stored volumes on
  // (re)subscribe.
  const applyVolume = useCallback(
    (vol: number) => {
      if (!participant || isLocalUser) return;

      participant.audioTrackPublications.forEach((pub) => {
        if (
          pub.track &&
          pub.source === TRACK_SOURCE.Microphone &&
          isBoostableAudioTrack(pub.track)
        ) {
          audioBoostManager.applyVolume(pub.track, boostKey(user.id, pub.source), vol);
        }
      });
    },
    [participant, isLocalUser, user.id],
  );

  const handleVolumeChange = (_event: Event, newValue: number | number[]) => {
    const val = newValue as number;
    setVolume(val);
    applyVolume(val);
    setStoredVolume(user.id, val / 100);
  };

  const handleLocalMuteToggle = () => {
    if (isLocallyMuted) {
      // Unmute: restore previous volume
      const restored = previousVolume > 0 ? previousVolume : 100;
      setVolume(restored);
      applyVolume(restored);
      setStoredVolume(user.id, restored / 100);
      showNotification(`Unmuted ${user.displayName || user.username}`, "info");
    } else {
      // Mute: save current volume and set to 0
      setPreviousVolume(volume);
      setVolume(0);
      applyVolume(0);
      setStoredVolume(user.id, 0);
      showNotification(`Muted ${user.displayName || user.username}`, "info");
    }
    onClose();
  };

  // Server mute/unmute (moderator action)
  const handleServerMuteToggle = async () => {
    if (!voiceState.currentChannelId) return;
    const newMuteState = !user.isServerMuted;
    try {
      await livekitControllerMuteParticipant({
        path: { channelId: voiceState.currentChannelId },
        body: { participantIdentity: user.id, mute: newMuteState },
        throwOnError: true,
      });
    } catch (error) {
      logger.error("Failed to server mute/unmute participant:", error);
    }
    onClose();
  };

  const handleViewProfile = () => {
    onClose();
    onViewProfile();
  };

  const hasModeration = canKick || canTimeout || canBan;

  return (
    <>
      <Menu
        anchorReference="anchorPosition"
        anchorPosition={anchorPosition ?? undefined}
        open={open}
        onClose={onClose}
      >
        <MenuItem onClick={handleViewProfile}>
          <ListItemIcon>
            <PersonIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>View Profile</ListItemText>
        </MenuItem>

        {!isLocalUser && (
          <>
            <Divider />

            {/* Local Volume Controls */}
            <MenuItem onClick={handleLocalMuteToggle}>
              <ListItemIcon>
                {isLocallyMuted ? (
                  <VolumeUpIcon fontSize="small" />
                ) : (
                  <VolumeOffIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText>
                {isLocallyMuted ? "Unmute for Me" : "Mute for Me"}
              </ListItemText>
            </MenuItem>

            <Box sx={{ px: 2, py: 1, minWidth: 200 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                gutterBottom
              >
                User Volume
              </Typography>
              <Slider
                value={volume}
                onChange={handleVolumeChange}
                min={0}
                max={200}
                step={1}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => `${v}%`}
                size="small"
                onClick={(e) => e.stopPropagation()}
              />
            </Box>

            {communityId && canMuteParticipant && (
              <>
                <Divider />
                <MenuItem onClick={handleServerMuteToggle}>
                  <ListItemIcon>
                    <MicOffIcon fontSize="small" color="warning" />
                  </ListItemIcon>
                  <ListItemText>
                    {user.isServerMuted ? "Server Unmute" : "Server Mute"}
                  </ListItemText>
                </MenuItem>
              </>
            )}

            {communityId && hasModeration && (
              <>
                <Divider />
                {canKick && (
                  <MenuItem
                    onClick={() => {
                      onClose();
                      setKickDialogOpen(true);
                    }}
                  >
                    <ListItemIcon>
                      <PersonRemoveIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Kick</ListItemText>
                  </MenuItem>
                )}
                {canTimeout && (
                  <MenuItem
                    onClick={() => {
                      onClose();
                      setTimeoutDialogOpen(true);
                    }}
                  >
                    <ListItemIcon>
                      <TimerIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Timeout</ListItemText>
                  </MenuItem>
                )}
                {canBan && (
                  <MenuItem
                    onClick={() => {
                      onClose();
                      setBanDialogOpen(true);
                    }}
                    sx={{ color: "error.main" }}
                  >
                    <ListItemIcon sx={{ color: "error.main" }}>
                      <BlockIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Ban</ListItemText>
                  </MenuItem>
                )}
              </>
            )}
          </>
        )}
      </Menu>

      {communityId && (
        <>
          <BanDialog
            open={banDialogOpen}
            onClose={() => setBanDialogOpen(false)}
            communityId={communityId}
            userId={user.id}
            userName={user.username}
          />
          <TimeoutDialog
            open={timeoutDialogOpen}
            onClose={() => setTimeoutDialogOpen(false)}
            communityId={communityId}
            userId={user.id}
            userName={user.username}
          />
          <KickConfirmDialog
            open={kickDialogOpen}
            onClose={() => setKickDialogOpen(false)}
            communityId={communityId}
            userId={user.id}
            userName={user.username}
          />
        </>
      )}
    </>
  );
};

export default VoiceUserContextMenu;
