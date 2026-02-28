import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { Track } from "livekit-client";
import BanDialog from "../Moderation/BanDialog";
import TimeoutDialog from "../Moderation/TimeoutDialog";
import KickConfirmDialog from "../Moderation/KickConfirmDialog";
import { getApiBaseUrl } from "../../config/env";
import { getAccessToken } from "../../utils/tokenService";
import { useNotification } from "../../contexts/NotificationContext";
import type { VoicePresenceUserDto } from "../../api-client/types.gen";
import { VOLUME_STORAGE_PREFIX } from "../../constants/voice";
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

  // Web Audio GainNode for >100% amplification
  const gainNodesRef = useRef<Map<string, { gainNode: GainNode; source: MediaStreamAudioSourceNode; context: AudioContext }>>(new Map());

  // Cleanup gain nodes on unmount
  useEffect(() => {
    const nodes = gainNodesRef.current;
    return () => {
      nodes.forEach(({ context }) => context.close());
      nodes.clear();
    };
  }, []);

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

  // Apply volume to LiveKit participant tracks (with GainNode for >100%)
  const applyVolume = useCallback(
    (vol: number) => {
      if (!participant || isLocalUser) return;

      participant.audioTrackPublications.forEach((pub) => {
        if (pub.track && (pub.source === Track.Source.Microphone || pub.source === Track.Source.ScreenShareAudio)) {
          const key = `${user.id}:${pub.source}`;

          if (vol <= 100) {
            // Standard range: use track.setVolume (0-1.0)
            // Clean up any existing GainNode first
            const existingEntry = gainNodesRef.current.get(key);
            if (existingEntry) {
              existingEntry.source.disconnect();
              existingEntry.context.close();
              gainNodesRef.current.delete(key);
            }
            pub.track.setVolume(vol / 100);
          } else {
            // Boost range: mute LiveKit track output to prevent double audio,
            // route through GainNode for amplification
            pub.track.setVolume(0);

            const mediaStream = pub.track.mediaStream;
            if (mediaStream) {
              let entry = gainNodesRef.current.get(key);

              if (!entry) {
                const context = new AudioContext();
                const source = context.createMediaStreamSource(mediaStream);
                const gainNode = context.createGain();
                source.connect(gainNode);
                gainNode.connect(context.destination);
                entry = { gainNode, source, context };
                gainNodesRef.current.set(key, entry);
              }

              entry.gainNode.gain.value = vol / 100; // 1.0 - 2.0
            }
          }
        }
      });
    },
    [participant, isLocalUser, user.id],
  );

  // Apply stored volume when participant joins/changes
  useEffect(() => {
    if (participant && !isLocalUser) {
      const stored = getStoredVolume(user.id);
      if (stored !== null) {
        applyVolume(Math.round(stored * 100));
      }
    }
  }, [participant, isLocalUser, user.id, applyVolume]);

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

  // Server mute (moderator action)
  const handleServerMute = async () => {
    if (!voiceState.currentChannelId) return;
    try {
      const baseUrl = getApiBaseUrl();
      const token = getAccessToken();
      const response = await fetch(
        `${baseUrl}/livekit/channels/${voiceState.currentChannelId}/mute-participant`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ participantIdentity: user.id, mute: true }),
        },
      );
      if (!response.ok) throw new Error("Failed to mute");
    } catch (error) {
      logger.error("Failed to server mute participant:", error);
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
                <MenuItem onClick={handleServerMute}>
                  <ListItemIcon>
                    <MicOffIcon fontSize="small" color="warning" />
                  </ListItemIcon>
                  <ListItemText>Server Mute</ListItemText>
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
