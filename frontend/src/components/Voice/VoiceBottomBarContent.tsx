import React, { useState, useCallback, useId, Suspense, lazy } from "react";
import { visuallyHidden } from "@mui/utils";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tooltip,
  Divider,
  Menu,
  MenuItem,
  Badge,
  Portal,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Button,
  CircularProgress,
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
  VolumeUp,
  FiberManualRecord,
  MovieCreation,
  PictureInPictureAlt,
  SpeakerPhone,
  PhoneInTalk,
  MoreHoriz,
  OpenInNew,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { navigateAfterOverlays } from "../../hooks/useOverlayHistory";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { useScreenShare } from "../../hooks/useScreenShare";
import { useLocalMediaState } from "../../hooks/useLocalMediaState";
import { useReplayBufferState } from "../../contexts/ReplayBufferContext";
import { useDebugPanelShortcut } from "../../hooks/useDebugPanelShortcut";
import { useVoicePublishPermissions } from "../../hooks/useVoicePublishPermissions";
import { DeviceSettingsDialog } from "./DeviceSettingsDialog";
import { SoundboardButton } from "./SoundboardButton";
import { ScreenSourcePicker } from "./ScreenSourcePicker";
import { CaptureReplayModal } from "./CaptureReplayModal";
import { useResponsive } from "../../hooks/useResponsive";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";
import { logger } from "../../utils/logger";
import { LAYOUT_CONSTANTS, TOUCH_TARGETS } from "../../utils/breakpoints";
import { useCallBarModel } from "../../data/callBar";
import { MobileSheet } from "../Mobile/common/MobileSheet";
import { ConnectionQualityIndicator } from "./ConnectionQualityIndicator";

// Debug panel is opt-in (Ctrl+Shift+D) and rarely used — keep it out of this
// already-lazy chunk until actually toggled on.
const VoiceDebugPanel = lazy(() =>
  import("./VoiceDebugPanel").then((m) => ({ default: m.VoiceDebugPanel }))
);

/** Rows in the phone "more" sheet: full-width, 48px touch targets. */
const moreItemSx = {
  width: "100%",
  minHeight: 48,
  px: 2,
  textAlign: "left",
  font: "inherit",
} as const;

/**
 * The actual bottom-bar UI + all of its voice-session hooks (device state,
 * deafen/mute effects, foreground resync, replay buffer, etc). Split out from
 * `VoiceBottomBar` (the always-mounted shell) so this — and the LiveKit
 * runtime it transitively needs via those hooks — is only fetched once a call
 * is actually connected, instead of on every page load (see PR-11).
 *
 * Rendered exclusively via `React.lazy` from `VoiceBottomBar`; do not import
 * this directly from always-mounted code.
 */
const VoiceBottomBarContent: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { state, actions } = useVoiceConnection();
  const screenShare = useScreenShare();
  const { isCameraEnabled, isMicrophoneEnabled } = useLocalMediaState();
  const { isMobile, shouldUseTouchUI } = useResponsive();
  const haptic = useHapticFeedback();
  // Channel voice permissions (SPEAK / VIDEO / SCREEN_SHARE; a timeout
  // removes all three but keeps listening). A control is disabled only when
  // it would turn something ON, so a stray live track can still be stopped.
  const publish = useVoicePublishPermissions();
  // Where the call is, its phase and the mic's state and labels: the same
  // model the new shell's call bar renders (data/callBar).
  const model = useCallBarModel(shouldUseTouchUI);
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(
    null
  );
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);
  const [showCaptureModal, setShowCaptureModal] = useState(false);
  const [isSpeakerphone, setIsSpeakerphone] = useState(false);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const closeMoreSheet = useCallback(() => setShowMoreSheet(false), []);

  // Use extracted hooks for cleaner organization
  const { showDebugPanel } = useDebugPanelShortcut();
  const cameraBlocked = !publish.canVideo && !isCameraEnabled;
  const shareBlocked = !publish.canShare && !screenShare.isScreenSharing;

  // Tooltip text and accessible names for camera and share. The mic's come
  // from the model (see the descriptions below): names stay fixed ("Mute",
  // "Camera", "Share screen") with aria-pressed carrying the state, and the
  // extra context a tooltip shows (a permission block, push-to-talk, server
  // mute) is the description.
  const descIds = { mic: useId(), camera: useId(), share: useId() };
  const cameraTitle = cameraBlocked
    ? publish.videoBlockedReason
    : isCameraEnabled ? "Turn off camera" : "Turn on camera";
  const shareTitle = shareBlocked
    ? publish.shareBlockedReason
    : screenShare.isScreenSharing ? "Stop screen share" : "Share screen";

  // The call's behaviour (push-to-talk keys, keep-alive, wake lock, Media
  // Session, presence heartbeat, deafen, server mute, volumes) is not here:
  // it runs in VoiceSessionEffects, above every layout, so it keeps going
  // whether or not this bar is on screen. This component only shows the call.

  // The soundboard's silent track is published by useSoundboardWarmup
  // (VoiceSessionEffects), not by this bar: see that hook.
  const hasSoundboard = Boolean(state.isConnected && state.communityId && actions.playSoundboard);

  // Automatically manage replay buffer when screen sharing
  const { isReplayBufferActive } = useReplayBufferState();

  // Define callbacks before any early returns (React hooks must be called unconditionally)
  const handleSettingsClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    setSettingsAnchor(event.currentTarget);
  }, []);

  const handleSettingsClose = useCallback(() => {
    setSettingsAnchor(null);
  }, []);

  const handleToggleVideo = useCallback(() => {
    actions.toggleVideo();
  }, [actions]);

  const handleDeviceSettingsOpen = useCallback(() => {
    setShowDeviceSettings(true);
    setSettingsAnchor(null);
  }, []);

  const handleDeviceSettingsClose = useCallback(() => {
    setShowDeviceSettings(false);
  }, []);

  const handleDeviceChange = useCallback(async (type: 'audio' | 'video' | 'audioOutput', deviceId: string) => {
    try {
      if (type === 'audio') {
        await actions.switchAudioInputDevice(deviceId);
      } else if (type === 'audioOutput') {
        await actions.switchAudioOutputDevice(deviceId);
      } else if (type === 'video') {
        await actions.switchVideoInputDevice(deviceId);
      }
    } catch (error) {
      logger.error(`Failed to switch ${type} device:`, error);
    }
  }, [actions]);

  const handleToggleScreenShare = useCallback(() => {
    screenShare.toggleScreenShare();
  }, [screenShare]);

  // Hold-to-talk (touch): press engages the mic through the shared PTT logic
  // (which enforces the server-mute guard), release re-mutes. Pointer capture
  // keeps transmit tied to this button even if the finger slides off it, so
  // release is driven by pointerup / pointercancel / lostpointercapture — not
  // pointerleave, which would end the hold mid-slide. The model's holdEnd
  // makes the release path idempotent across those overlapping events.
  const holdStart = model?.actions.holdStart;
  const holdEnd = model?.actions.holdEnd;
  const handlePttPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (state.isServerMuted || !holdStart) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    haptic.medium();
    holdStart();
  }, [state.isServerMuted, haptic, holdStart]);

  const handlePttPointerUp = useCallback(() => {
    // holdEnd is false when no hold is running (idempotent across the events)
    if (!holdEnd?.()) return;
    haptic.light();
  }, [haptic, holdEnd]);

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

  // Show bar if connected to either a channel or DM (the model is null
  // with neither)
  if (!state.isConnected || !model) {
    return null;
  }

  const { mic } = model;
  const micBlocked = mic.blocked;
  const isPTTActive = mic.mode !== "toggle";
  // On touch devices the PTT key can't be pressed, so the mic button becomes
  // a hold-to-talk control. Desktop PTT (keyboard) and non-PTT tap-to-mute
  // are unaffected.
  const isHoldToTalk = mic.mode === "holdToTalk";
  const isPTTKeyHeld = mic.transmitting;
  const micTitle = mic.title;
  const micLabel = mic.label;
  const micDescription = mic.description ?? "";

  const displayName = model.place.name;
  const displayType = model.kindLabel;

  // An automatic rejoin after the connection dropped (see
  // useVoiceForegroundResync). Cancel hangs up. Inline under the name on
  // desktop; on touch layouts its own full-width row (the controls leave the
  // phone name column too narrow, and Cancel needs a full touch target).
  const reconnectStatus = state.reconnect ? (
    <Box
      role="status"
      data-testid="voice-reconnecting"
      sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}
    >
      <CircularProgress size={10} thickness={6} color="warning" sx={{ flexShrink: 0 }} />
      <Typography variant="caption" color="warning.main" noWrap sx={{ minWidth: 0 }}>
        Reconnecting voice ({model.reconnectAttempt})…
      </Typography>
      <Button
        size="small"
        onClick={actions.cancelReconnect}
        sx={{
          minWidth: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : 0,
          minHeight: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : 0,
          px: shouldUseTouchUI ? 1 : 0.5,
          py: 0,
          ml: shouldUseTouchUI ? "auto" : 0,
          typography: "caption",
          textTransform: "none",
          flexShrink: 0,
        }}
      >
        Cancel
      </Button>
    </Box>
  ) : null;

  return (
    <>
      {/* Main Bottom Bar */}
      {/* Positioned by the VoiceBottomBar shell (fixed on desktop, in flow
          above the bottom nav on touch layouts). */}
      <Paper
        elevation={8}
        sx={{
          borderRadius: 0,
          backgroundColor: "background.paper",
          borderTop: 1,
          borderColor: "divider",
        }}
      >
        {shouldUseTouchUI && reconnectStatus && (
          <Box sx={{ px: 1.5, borderBottom: 1, borderColor: "divider" }}>{reconnectStatus}</Box>
        )}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: isMobile ? 0.5 : 3,
            py: isMobile ? 1 : 1.5,
            minHeight: isMobile ? LAYOUT_CONSTANTS.VOICE_BAR_HEIGHT_MOBILE : 64,
            gap: isMobile ? 0 : 1,
          }}
        >
          {/* Channel/DM Info */}
          <Box sx={{ display: "flex", alignItems: "center", gap: isMobile ? 0.5 : 2, flex: 1, minWidth: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: isMobile ? 0.5 : 1, minWidth: 0, pl: isMobile ? 1 : 0 }}>
              <VolumeUp color="primary" fontSize={isMobile ? "small" : "medium"} sx={{ flexShrink: 0 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight="medium" noWrap>
                  {displayName}
                </Typography>
                {state.reconnect ? (
                  // Touch layouts show it in its own row above (and no
                  // "Voice Connected" while reconnecting).
                  !shouldUseTouchUI && reconnectStatus
                ) : (
                  !isMobile && (
                    <Typography variant="caption" color="text.secondary">
                      {displayType}
                    </Typography>
                  )
                )}
              </Box>
            </Box>

            {/* Connection quality (3 bars, detail on hover) - hide on mobile */}
            {!isMobile && <ConnectionQualityIndicator room={state.room} />}

          </Box>

          {/* Descriptions for the toggles above (see micLabel) */}
          <Box component="span" sx={visuallyHidden}>
            <span id={descIds.mic}>{micDescription}</span>
            <span id={descIds.camera}>{cameraBlocked ? cameraTitle : ""}</span>
            <span id={descIds.share}>{shareBlocked ? shareTitle : ""}</span>
          </Box>

          {/* Voice Controls */}
          <Box
            data-testid="voice-bar-controls"
            sx={{ display: "flex", alignItems: "center", flexShrink: 0, gap: isMobile ? 0.25 : 1 }}
          >
            {/* Microphone */}
            <Tooltip
              title={micTitle}
              arrow={!isMobile}
              disableTouchListener={isHoldToTalk && !micBlocked}
            >
              <span>
              <IconButton
                disabled={micBlocked}
                aria-label={micLabel}
                aria-pressed={isHoldToTalk && !micBlocked ? undefined : !isMicrophoneEnabled}
                aria-describedby={micDescription ? descIds.mic : undefined}
                onClick={mic.tappable ? actions.toggleMute : undefined}
                onPointerDown={isHoldToTalk ? handlePttPointerDown : undefined}
                onPointerUp={isHoldToTalk ? handlePttPointerUp : undefined}
                onPointerCancel={isHoldToTalk ? handlePttPointerUp : undefined}
                onLostPointerCapture={isHoldToTalk ? handlePttPointerUp : undefined}
                onContextMenu={isHoldToTalk ? (e) => e.preventDefault() : undefined}
                color={!isMicrophoneEnabled && !isPTTKeyHeld ? "error" : "default"}
                size={isMobile ? "medium" : "medium"}
                sx={{
                  touchAction: isHoldToTalk ? "none" : undefined,
                  userSelect: isHoldToTalk ? "none" : undefined,
                  WebkitUserSelect: isHoldToTalk ? "none" : undefined,
                  backgroundColor: isPTTKeyHeld
                    ? theme.palette.semantic.status.positive
                    : state.isServerMuted
                      ? "warning.main"
                      : (!isMicrophoneEnabled ? "error.main" : "transparent"),
                  color: isPTTKeyHeld
                    ? theme.palette.getContrastText(theme.palette.semantic.status.positive)
                    : state.isServerMuted
                      ? "warning.contrastText"
                      : (!isMicrophoneEnabled ? "error.contrastText" : "text.primary"),
                  minWidth: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
                  minHeight: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
                  border: mic.speaking || isPTTKeyHeld
                    ? `2px solid ${theme.palette.semantic.status.positive}`
                    : "2px solid transparent",
                  boxShadow: mic.speaking || isPTTKeyHeld
                    ? `0 0 8px ${theme.palette.semantic.status.positive}`
                    : "none",
                  transition: "all 0.2s ease",
                  cursor: isPTTActive || state.isServerMuted ? "default" : "pointer",
                  "&:hover": {
                    backgroundColor: isPTTKeyHeld
                      ? theme.palette.semantic.status.positive
                      : state.isServerMuted
                        ? "warning.dark"
                        : (!isMicrophoneEnabled
                          ? "error.dark"
                          : "action.hover"),
                  },
                }}
              >
                {!isMicrophoneEnabled && !isPTTKeyHeld ? <MicOff /> : <Mic />}
              </IconButton>
              </span>
            </Tooltip>

            {/* Headphones/Deafen - a primary control on every layout */}
            <Tooltip title={state.isDeafened ? "Undeafen" : "Deafen"} arrow={!isMobile}>
              <IconButton
                aria-label="Deafen"
                aria-pressed={state.isDeafened}
                onClick={actions.toggleDeafen}
                color={state.isDeafened ? "error" : "default"}
                sx={{
                  backgroundColor: state.isDeafened
                    ? "error.main"
                    : "transparent",
                  color: state.isDeafened
                    ? "error.contrastText"
                    : "text.primary",
                  minWidth: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
                  minHeight: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
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

            {!isMobile && <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />}

            {/* Video */}
            <Tooltip
              title={cameraTitle}
              arrow={!isMobile}
            >
              <span>
              <IconButton
                disabled={cameraBlocked}
                aria-label="Camera"
                aria-pressed={isCameraEnabled}
                aria-describedby={cameraBlocked ? descIds.camera : undefined}
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
                  minWidth: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
                  minHeight: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
                  "&:hover": {
                    backgroundColor: isCameraEnabled
                      ? "primary.dark"
                      : "action.hover",
                  },
                }}
              >
                {isCameraEnabled ? <Videocam /> : <VideocamOff />}
              </IconButton>
              </span>
            </Tooltip>

            {/* Secondary actions: inline on desktop/tablet; in the "more"
                sheet on phone so the bar fits 320px. */}
            {!isMobile && (
              <>
            {/* Screen Share */}
            <Tooltip
              title={shareTitle}
              arrow={!isMobile}
            >
              <span>
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
                  disabled={shareBlocked}
                  aria-label="Share screen"
                  aria-pressed={screenShare.isScreenSharing}
                  aria-describedby={shareBlocked ? descIds.share : undefined}
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
                    minWidth: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
                    minHeight: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
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
              </span>
            </Tooltip>

            {/* [replay, soundboard, call view, settings] */}
            <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

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
                    minWidth: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
                    minHeight: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
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

            {/* Soundboard - community voice channels only */}
            {state.isConnected && state.communityId && actions.playSoundboard && (
              <SoundboardButton
                communityId={state.communityId}
                onPlay={actions.playSoundboard}
                isMobile={isMobile}
              />
            )}

            {/* Show Video Tiles - visible when tiles are hidden and user is connected */}
            {!state.showVideoTiles && state.isConnected && (
              <Tooltip title="Open call view" arrow={!isMobile}>
                <IconButton
                  aria-label="Open call view"
                  onClick={() => actions.revealVideoTiles()}
                  size={isMobile ? "medium" : "medium"}
                  sx={{
                    minWidth: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
                    minHeight: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
                    "&:hover": {
                      backgroundColor: "action.hover",
                    },
                  }}
                >
                  <PictureInPictureAlt />
                </IconButton>
              </Tooltip>
            )}
              </>
            )}

            {/* Phone: everything else lives in the "more" sheet */}
            {isMobile && (
              <Tooltip title="More voice options">
                <IconButton
                  onClick={() => setShowMoreSheet(true)}
                  aria-haspopup="dialog"
                  sx={{
                    minWidth: TOUCH_TARGETS.MINIMUM,
                    minHeight: TOUCH_TARGETS.MINIMUM,
                    color: "text.primary",
                  }}
                >
                  <Badge
                    variant="dot"
                    color="primary"
                    invisible={!screenShare.isScreenSharing && !isReplayBufferActive}
                  >
                    <MoreHoriz />
                  </Badge>
                </IconButton>
              </Tooltip>
            )}

            {/* Settings - hide on mobile, use menu instead */}
            {!isMobile && (
              <>
                <Tooltip title="Voice settings">
                  <IconButton onClick={handleSettingsClick} aria-label="Voice settings">
                    <Settings />
                  </IconButton>
                </Tooltip>
              </>
            )}

            {!isMobile && <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />}

            {/* Disconnect */}
            <Tooltip title="Disconnect" arrow={!isMobile}>
              <IconButton
                onClick={actions.leaveVoiceChannel}
                color="error"
                size={isMobile ? "medium" : "medium"}
                sx={{
                  minWidth: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
                  minHeight: shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : "auto",
                  // Phone: a filled red hang-up so it reads as the call's
                  // primary destructive action at a glance.
                  ...(isMobile && {
                    backgroundColor: "error.main",
                    color: "error.contrastText",
                  }),
                  "&:hover": {
                    backgroundColor: isMobile ? "error.dark" : "error.main",
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
          {/* While the embedded stage is mounted, pip state is irrelevant —
              the stage always shows the tiles, so this item would flip its
              label with no visible effect. Hide it entirely instead. */}
          {!state.stageMounted && (
            <MenuItem
              onClick={() => {
                // Expanded (shown + not collapsed to a pill) collapses to the pill;
                // anything else (hidden, or already a pill) reveals it fully again.
                if (state.showVideoTiles && !state.pipCollapsed) {
                  actions.setPipCollapsed(true);
                } else {
                  actions.revealVideoTiles();
                }
                handleSettingsClose();
              }}
            >
              {state.showVideoTiles && !state.pipCollapsed ? "Hide Video Tiles" : "Show Video Tiles"}
            </MenuItem>
          )}
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

        {/* Phone "more" sheet: the secondary call actions that don't fit in
            the 320px bar. Each action closes the sheet (except soundboard,
            which opens its own picker). */}
        {isMobile && (
          <MobileSheet open={showMoreSheet} onClose={closeMoreSheet} title={displayName} maxHeight="75vh">
            <List data-testid="voice-more-sheet" disablePadding sx={{ mx: -2, my: -1 }}>
              <ListItemButton
                component="button"
                disabled={shareBlocked}
                onClick={() => {
                  closeMoreSheet();
                  handleToggleScreenShare();
                }}
                sx={moreItemSx}
              >
                <ListItemIcon>
                  {screenShare.isScreenSharing ? <StopScreenShare color="primary" /> : <ScreenShare />}
                </ListItemIcon>
                <ListItemText
                  primary={screenShare.isScreenSharing ? "Stop sharing screen" : "Share screen"}
                  secondary={shareBlocked ? publish.shareBlockedReason : undefined}
                />
              </ListItemButton>

              {isReplayBufferActive && (
                <ListItemButton
                  component="button"
                  onClick={() => {
                    closeMoreSheet();
                    setShowCaptureModal(true);
                  }}
                  sx={moreItemSx}
                >
                  <ListItemIcon>
                    <MovieCreation color="success" />
                  </ListItemIcon>
                  <ListItemText primary="Capture replay" />
                </ListItemButton>
              )}

              {supportsSpeakerToggle && (
                <ListItemButton
                  component="button"
                  onClick={() => {
                    closeMoreSheet();
                    void handleToggleSpeakerphone();
                  }}
                  sx={moreItemSx}
                >
                  <ListItemIcon>
                    {isSpeakerphone ? <SpeakerPhone color="primary" /> : <PhoneInTalk />}
                  </ListItemIcon>
                  <ListItemText primary={isSpeakerphone ? "Switch to earpiece" : "Switch to speaker"} />
                </ListItemButton>
              )}

              {!state.showVideoTiles && (
                <ListItemButton
                  component="button"
                  onClick={() => {
                    closeMoreSheet();
                    actions.revealVideoTiles();
                  }}
                  sx={moreItemSx}
                >
                  <ListItemIcon>
                    <PictureInPictureAlt />
                  </ListItemIcon>
                  <ListItemText primary="Open call view" />
                </ListItemButton>
              )}

              {hasSoundboard && state.communityId && actions.playSoundboard && (
                <ListItem sx={{ ...moreItemSx, py: 0 }}>
                  {/* SoundboardButton is a 48px icon button; pull it left so
                      its glyph and the label line up with the other rows. */}
                  <ListItemIcon sx={{ minWidth: 0, ml: "-12px", mr: "20px" }}>
                    <SoundboardButton
                      communityId={state.communityId}
                      onPlay={actions.playSoundboard}
                      isMobile
                    />
                  </ListItemIcon>
                  <ListItemText primary="Soundboard" />
                </ListItem>
              )}

              <Divider sx={{ my: 0.5 }} />

              <ListItemButton
                component="button"
                onClick={() => {
                  closeMoreSheet();
                  setShowDeviceSettings(true);
                }}
                sx={moreItemSx}
              >
                <ListItemIcon>
                  <Settings />
                </ListItemIcon>
                <ListItemText primary="Voice & video settings" />
              </ListItemButton>

              <ListItemButton
                component="button"
                onClick={() => {
                  closeMoreSheet();
                  // Unwind the sheet's history entry first, so back from
                  // Settings returns to the call screen (not a dead entry).
                  navigateAfterOverlays(() => navigate("/settings"));
                }}
                sx={moreItemSx}
              >
                <ListItemIcon>
                  <OpenInNew />
                </ListItemIcon>
                <ListItemText primary="All settings" />
              </ListItemButton>
            </List>
          </MobileSheet>
        )}

        {/* Capture Replay Dialog */}
        <CaptureReplayModal
          open={showCaptureModal}
          onClose={() => setShowCaptureModal(false)}
        />
      </Paper>

      {/* Debug Panel - Toggle with Ctrl+Shift+D. Portaled so its own
          z-index isn't capped by the bar wrapper's stacking context. */}
      {showDebugPanel && (
        <Portal>
          <Suspense fallback={null}>
            <VoiceDebugPanel />
          </Suspense>
        </Portal>
      )}
    </>
  );
};

export { VoiceBottomBarContent };
export default VoiceBottomBarContent;
