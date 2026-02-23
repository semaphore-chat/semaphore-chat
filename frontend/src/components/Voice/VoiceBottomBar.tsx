import React, { useState, useCallback } from "react";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  Divider,
  Menu,
  MenuItem,
  Badge,
  Collapse,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  Mic,
  MicOff,
  Headset,
  HeadsetOff,
  Videocam,
  VideocamOff,
  ScreenShare,
  StopScreenShare,
  CallEnd,
  Settings,
  ExpandLess,
  ExpandMore,
  VolumeUp,
  FiberManualRecord,
  MovieCreation,
  VideoCall,
  SpeakerPhone,
  PhoneInTalk,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { useScreenShare } from "../../hooks/useScreenShare";
import { useLocalMediaState } from "../../hooks/useLocalMediaState";
import { useDeafenEffect } from "../../hooks/useDeafenEffect";
import { useReplayBufferState } from "../../contexts/ReplayBufferContext";
import { useVoiceParticipantCount } from "../../hooks/useVoiceParticipantCount";
import { useDebugPanelShortcut } from "../../hooks/useDebugPanelShortcut";
import { usePushToTalk } from "../../hooks/usePushToTalk";
import { VoiceChannelUserList } from "./VoiceChannelUserList";
import { DeviceSettingsDialog } from "./DeviceSettingsDialog";
import { ScreenSourcePicker } from "./ScreenSourcePicker";
import { VoiceDebugPanel } from "./VoiceDebugPanel";
import { CaptureReplayModal } from "./CaptureReplayModal";
import { ChannelType } from "../../types/channel.type";
import { useResponsive } from "../../hooks/useResponsive";
import { logger } from "../../utils/logger";
import { LAYOUT_CONSTANTS } from "../../utils/breakpoints";
import { useSpeakingDetection } from "../../hooks/useSpeakingDetection";
import { useVoicePresenceHeartbeat } from "../../hooks/useVoicePresenceHeartbeat";
import { useCurrentUser } from "../../hooks/useCurrentUser";

export const VoiceBottomBar: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { state, actions } = useVoiceConnection();
  const screenShare = useScreenShare();
  const { isCameraEnabled, isMicrophoneEnabled } = useLocalMediaState();
  const { isMobile } = useResponsive();
  const { user: currentUser } = useCurrentUser();
  const { isSpeaking } = useSpeakingDetection();
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(
    null
  );
  const [showUserList, setShowUserList] = useState(false);
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);
  const [showCaptureModal, setShowCaptureModal] = useState(false);
  const [isSpeakerphone, setIsSpeakerphone] = useState(false);

  // Use extracted hooks for cleaner organization
  const { showDebugPanel } = useDebugPanelShortcut();
  const { isActive: isPTTActive, isKeyHeld: isPTTKeyHeld, currentKeyDisplay: pttKeyDisplay } = usePushToTalk();
  const { participantCount } = useVoiceParticipantCount({
    channelId: state.currentChannelId,
    dmGroupId: state.currentDmGroupId,
    contextType: state.contextType,
  });

  // Keep voice presence TTL alive in Redis while connected
  useVoicePresenceHeartbeat({
    channelId: state.currentChannelId,
    dmGroupId: state.currentDmGroupId,
    contextType: state.contextType,
  });

  // Implement proper deafen functionality (mute received audio)
  useDeafenEffect();

  // Automatically manage replay buffer when screen sharing
  const { isReplayBufferActive } = useReplayBufferState();

  // Check if the current user is speaking
  const isCurrentUserSpeaking = currentUser ? isSpeaking(currentUser.id) : false;

  // Define callbacks before any early returns (React hooks must be called unconditionally)
  const handleSettingsClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    setSettingsAnchor(event.currentTarget);
  }, []);

  const handleSettingsClose = useCallback(() => {
    setSettingsAnchor(null);
  }, []);

  const handleToggleVideo = useCallback(() => {
    actions.toggleVideo();
    if (!isCameraEnabled) {
      actions.setShowVideoTiles(true);
    }
  }, [actions, isCameraEnabled]);

  const handleDeviceSettingsOpen = useCallback(() => {
    setShowDeviceSettings(true);
    setSettingsAnchor(null);
  }, []);

  const handleDeviceSettingsClose = useCallback(() => {
    setShowDeviceSettings(false);
  }, []);

  const handleDeviceChange = useCallback(async (type: 'audio' | 'video', deviceId: string) => {
    try {
      if (type === 'audio') {
        await actions.switchAudioInputDevice(deviceId);
      } else if (type === 'video') {
        await actions.switchVideoInputDevice(deviceId);
      }
    } catch (error) {
      logger.error(`Failed to switch ${type} device:`, error);
    }
  }, [actions]);

  const handleToggleScreenShare = useCallback(() => {
    if (!screenShare.isScreenSharing) {
      actions.setShowVideoTiles(true);
    }
    screenShare.toggleScreenShare();
  }, [screenShare, actions]);

  // Check if browser supports audio output switching (setSinkId)
  const supportsSpeakerToggle = isMobile && 'setSinkId' in HTMLMediaElement.prototype;

  const handleToggleSpeakerphone = useCallback(async () => {
    try {
      const newSpeakerState = !isSpeakerphone;

      // Enumerate real audio output devices to find valid IDs
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

      // "communications" is the earpiece on some platforms; "default" is the system default (speaker on mobile)
      const earpieceDevice = audioOutputs.find(d => d.deviceId === 'communications');
      const defaultDevice = audioOutputs.find(d => d.deviceId === 'default') ?? audioOutputs[0];

      const targetDeviceId = newSpeakerState
        ? (defaultDevice?.deviceId ?? 'default')
        : (earpieceDevice?.deviceId ?? 'default');

      await actions.switchAudioOutputDevice(targetDeviceId);
      setIsSpeakerphone(newSpeakerState);
    } catch (error) {
      logger.error('Failed to toggle speakerphone:', error);
    }
  }, [isSpeakerphone, actions]);

  // Show bar if connected to either a channel or DM
  if (!state.isConnected || (!state.currentChannelId && !state.currentDmGroupId)) {
    return null;
  }

  // Determine display name and type
  const displayName = state.contextType === 'dm'
    ? state.dmGroupName || 'Direct Message'
    : state.channelName || 'Voice Channel';

  const displayType = state.contextType === 'dm' ? 'DM Voice Call' : 'Voice Connected';

  return (
    <>
      {/* User List Expansion - only for channels */}
      {state.contextType === 'channel' && state.currentChannelId && (
        <Collapse in={showUserList} timeout={300}>
          <Box
            sx={{
              position: "fixed",
              bottom: 80,
              left: 0,
              right: 0,
              zIndex: 1200,
              display: "flex",
              justifyContent: "center",
              px: 2,
            }}
          >
            <Box sx={{ maxWidth: 400, width: "100%" }}>
              <VoiceChannelUserList
                channel={{
                  id: state.currentChannelId,
                  name: state.channelName || "Voice Channel",
                  type: ChannelType.VOICE,
                  communityId: state.communityId || "",
                  isPrivate: state.isPrivate ?? false,
                  createdAt: state.createdAt || "",
                }}
              />
            </Box>
          </Box>
        </Collapse>
      )}

      {/* Main Bottom Bar */}
      <Paper
        elevation={8}
        sx={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1300,
          borderRadius: 0,
          backgroundColor: "background.paper",
          borderTop: 1,
          borderColor: "divider",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: isMobile ? 1 : 3,
            py: isMobile ? 1 : 1.5,
            minHeight: isMobile ? LAYOUT_CONSTANTS.VOICE_BAR_HEIGHT_MOBILE : 64,
            gap: isMobile ? 0.5 : 1,
          }}
        >
          {/* Channel/DM Info */}
          <Box sx={{ display: "flex", alignItems: "center", gap: isMobile ? 0.5 : 2, flex: 1, minWidth: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
              <VolumeUp color="primary" sx={{ flexShrink: 0 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight="medium" noWrap>
                  {displayName}
                </Typography>
                {!isMobile && (
                  <Typography variant="caption" color="text.secondary">
                    {displayType}
                  </Typography>
                )}
              </Box>
            </Box>

            {/* Connection Status - hide on mobile */}
            {!isMobile && (
              <Chip
                label={state.isConnected ? "Connected" : "Connecting..."}
                color={state.isConnected ? "success" : "warning"}
                size="small"
                sx={{ height: 24 }}
              />
            )}

            {/* Participants Count - only for channels, hide on mobile */}
            {state.contextType === 'channel' && !isMobile && (
              <Tooltip title="Show participants">
                <IconButton
                  size="small"
                  onClick={() => setShowUserList(!showUserList)}
                  sx={{
                    backgroundColor: showUserList
                      ? "action.selected"
                      : "transparent",
                  }}
                >
                  <Badge badgeContent={participantCount} color="primary">
                    {showUserList ? <ExpandMore /> : <ExpandLess />}
                  </Badge>
                </IconButton>
              </Tooltip>
            )}
          </Box>

          {/* Voice Controls */}
          <Box sx={{ display: "flex", alignItems: "center", gap: isMobile ? 0.5 : 1 }}>
            {/* Microphone */}
            <Tooltip
              title={
                isPTTActive
                  ? (isPTTKeyHeld ? "Transmitting..." : `Hold ${pttKeyDisplay} to talk`)
                  : (!isMicrophoneEnabled ? "Unmute" : "Mute")
              }
              arrow={!isMobile}
            >
              <IconButton
                onClick={isPTTActive ? undefined : actions.toggleMute}
                color={!isMicrophoneEnabled && !isPTTKeyHeld ? "error" : "default"}
                size={isMobile ? "medium" : "medium"}
                sx={{
                  backgroundColor: isPTTKeyHeld
                    ? theme.palette.semantic.status.positive
                    : (!isMicrophoneEnabled ? "error.main" : "transparent"),
                  color: isPTTKeyHeld
                    ? theme.palette.semantic.status.positiveText
                    : (!isMicrophoneEnabled ? "error.contrastText" : "text.primary"),
                  minWidth: isMobile ? 48 : "auto",
                  minHeight: isMobile ? 48 : "auto",
                  border: (isMicrophoneEnabled && isCurrentUserSpeaking) || isPTTKeyHeld
                    ? `2px solid ${theme.palette.semantic.status.positive}`
                    : "2px solid transparent",
                  boxShadow: (isMicrophoneEnabled && isCurrentUserSpeaking) || isPTTKeyHeld
                    ? `0 0 8px ${theme.palette.semantic.status.positive}`
                    : "none",
                  transition: "all 0.2s ease",
                  cursor: isPTTActive ? "default" : "pointer",
                  "&:hover": {
                    backgroundColor: isPTTKeyHeld
                      ? theme.palette.semantic.status.positive
                      : (!isMicrophoneEnabled
                        ? "error.dark"
                        : "action.hover"),
                  },
                }}
              >
                {!isMicrophoneEnabled && !isPTTKeyHeld ? <MicOff /> : <Mic />}
              </IconButton>
            </Tooltip>

            {/* Headphones/Deafen - hide on mobile */}
            {!isMobile && (
              <Tooltip title={state.isDeafened ? "Undeafen" : "Deafen"}>
                <IconButton
                  onClick={actions.toggleDeafen}
                  color={state.isDeafened ? "error" : "default"}
                  sx={{
                    backgroundColor: state.isDeafened
                      ? "error.main"
                      : "transparent",
                    color: state.isDeafened
                      ? "error.contrastText"
                      : "text.primary",
                    "&:hover": {
                      backgroundColor: state.isDeafened
                        ? "error.dark"
                        : "action.hover",
                    },
                  }}
                >
                  {state.isDeafened ? <HeadsetOff /> : <Headset />}
                </IconButton>
              </Tooltip>
            )}

            {/* Speakerphone toggle - mobile only, when browser supports setSinkId */}
            {supportsSpeakerToggle && (
              <Tooltip title={isSpeakerphone ? "Switch to earpiece" : "Switch to speaker"}>
                <IconButton
                  onClick={handleToggleSpeakerphone}
                  size="medium"
                  sx={{
                    backgroundColor: isSpeakerphone
                      ? "primary.main"
                      : "transparent",
                    color: isSpeakerphone
                      ? "primary.contrastText"
                      : "text.primary",
                    minWidth: 48,
                    minHeight: 48,
                    "&:hover": {
                      backgroundColor: isSpeakerphone
                        ? "primary.dark"
                        : "action.hover",
                    },
                  }}
                >
                  {isSpeakerphone ? <SpeakerPhone /> : <PhoneInTalk />}
                </IconButton>
              </Tooltip>
            )}

            <Divider orientation="vertical" flexItem sx={{ mx: isMobile ? 0.5 : 1 }} />

            {/* Video */}
            <Tooltip
              title={
                isCameraEnabled ? "Turn off camera" : "Turn on camera"
              }
              arrow={!isMobile}
            >
              <IconButton
                onClick={handleToggleVideo}
                color={isCameraEnabled ? "primary" : "default"}
                size={isMobile ? "medium" : "medium"}
                sx={{
                  backgroundColor: isCameraEnabled
                    ? "primary.main"
                    : "transparent",
                  color: isCameraEnabled
                    ? "primary.contrastText"
                    : "text.primary",
                  minWidth: isMobile ? 48 : "auto",
                  minHeight: isMobile ? 48 : "auto",
                  "&:hover": {
                    backgroundColor: isCameraEnabled
                      ? "primary.dark"
                      : "action.hover",
                  },
                }}
              >
                {isCameraEnabled ? <Videocam /> : <VideocamOff />}
              </IconButton>
            </Tooltip>

            {/* Screen Share */}
            <Tooltip
              title={
                screenShare.isScreenSharing ? "Stop screen share" : "Share screen"
              }
              arrow={!isMobile}
            >
              <Badge
                overlap="circular"
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                badgeContent={
                  isReplayBufferActive ? (
                    <FiberManualRecord
                      sx={{
                        width: 8,
                        height: 8,
                        color: theme.palette.semantic.status.positive,
                        animation: 'pulse 1.5s ease-in-out infinite',
                        '@keyframes pulse': {
                          '0%, 100%': { opacity: 1 },
                          '50%': { opacity: 0.5 },
                        },
                      }}
                    />
                  ) : null
                }
              >
                <IconButton
                  onClick={handleToggleScreenShare}
                  color={screenShare.isScreenSharing ? "primary" : "default"}
                  size={isMobile ? "medium" : "medium"}
                  sx={{
                    backgroundColor: screenShare.isScreenSharing
                      ? "primary.main"
                      : "transparent",
                    color: screenShare.isScreenSharing
                      ? "primary.contrastText"
                      : "text.primary",
                    minWidth: isMobile ? 48 : "auto",
                    minHeight: isMobile ? 48 : "auto",
                    "&:hover": {
                      backgroundColor: screenShare.isScreenSharing
                        ? "primary.dark"
                        : "action.hover",
                    },
                  }}
                >
                  {screenShare.isScreenSharing ? <StopScreenShare /> : <ScreenShare />}
                </IconButton>
              </Badge>
            </Tooltip>

            {/* Capture Replay - only show when replay buffer is active */}
            {isReplayBufferActive && (
              <Tooltip
                title="Capture Replay"
                arrow={!isMobile}
              >
                <IconButton
                  onClick={() => setShowCaptureModal(true)}
                  color="success"
                  size={isMobile ? "medium" : "medium"}
                  sx={{
                    minWidth: isMobile ? 48 : "auto",
                    minHeight: isMobile ? 48 : "auto",
                    "&:hover": {
                      backgroundColor: "success.main",
                      color: "success.contrastText",
                    },
                  }}
                >
                  <MovieCreation />
                </IconButton>
              </Tooltip>
            )}

            {/* Show Video Tiles - visible when tiles are hidden and user is connected */}
            {!state.showVideoTiles && state.isConnected && (
              <Tooltip title="Show Video Tiles" arrow={!isMobile}>
                <IconButton
                  onClick={() => actions.setShowVideoTiles(true)}
                  size={isMobile ? "medium" : "medium"}
                  sx={{
                    minWidth: isMobile ? 48 : "auto",
                    minHeight: isMobile ? 48 : "auto",
                    "&:hover": {
                      backgroundColor: "action.hover",
                    },
                  }}
                >
                  <VideoCall />
                </IconButton>
              </Tooltip>
            )}

            {/* Settings - hide on mobile, use menu instead */}
            {!isMobile && (
              <>
                <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
                <Tooltip title="Voice settings">
                  <IconButton onClick={handleSettingsClick}>
                    <Settings />
                  </IconButton>
                </Tooltip>
              </>
            )}

            <Divider orientation="vertical" flexItem sx={{ mx: isMobile ? 0.5 : 1 }} />

            {/* Disconnect */}
            <Tooltip title="Disconnect" arrow={!isMobile}>
              <IconButton
                onClick={actions.leaveVoiceChannel}
                color="error"
                size={isMobile ? "medium" : "medium"}
                sx={{
                  minWidth: isMobile ? 48 : "auto",
                  minHeight: isMobile ? 48 : "auto",
                  "&:hover": {
                    backgroundColor: "error.main",
                    color: "error.contrastText",
                  },
                }}
              >
                <CallEnd />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Settings Menu */}
        <Menu
          anchorEl={settingsAnchor}
          open={Boolean(settingsAnchor)}
          onClose={handleSettingsClose}
          anchorOrigin={{
            vertical: "top",
            horizontal: "center",
          }}
          transformOrigin={{
            vertical: "bottom",
            horizontal: "center",
          }}
        >
          <MenuItem
            onClick={() => {
              actions.setShowVideoTiles(!state.showVideoTiles);
              handleSettingsClose();
            }}
          >
            {state.showVideoTiles ? "Hide Video Tiles" : "Show Video Tiles"}
          </MenuItem>
          <MenuItem onClick={handleDeviceSettingsOpen}>
            Voice & Video Settings
          </MenuItem>
          <Divider />
          <MenuItem
            onClick={() => {
              navigate("/settings");
              handleSettingsClose();
            }}
          >
            All Settings
          </MenuItem>
        </Menu>

        {/* Device Settings Dialog */}
        <DeviceSettingsDialog
          open={showDeviceSettings}
          onClose={handleDeviceSettingsClose}
          onDeviceChange={handleDeviceChange}
        />

        {/* Screen Source Picker Dialog */}
        <ScreenSourcePicker
          open={screenShare.showSourcePicker}
          onClose={screenShare.handleSourcePickerClose}
          onSelect={screenShare.handleSourceSelect}
        />

        {/* Capture Replay Dialog */}
        <CaptureReplayModal
          open={showCaptureModal}
          onClose={() => setShowCaptureModal(false)}
        />
      </Paper>

      {/* Debug Panel - Toggle with Ctrl+Shift+D */}
      {showDebugPanel && <VoiceDebugPanel />}
    </>
  );
};
