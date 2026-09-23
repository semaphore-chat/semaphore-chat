import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Card,
  Fade,
  Tooltip,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import {
  Mic,
  MicOff,
  Videocam,
  VideocamOff,
  ScreenShare,
  FiberManualRecord,
  VisibilityOff,
} from '@mui/icons-material';
import type {
  TrackPublication,
  VideoTrack,
  RemoteParticipant,
  LocalParticipant,
} from 'livekit-client';
import UserAvatar from '../Common/UserAvatar';
import ScreenShareVolumeControl from './ScreenShareVolumeControl';
import { useSpeaking } from '../../hooks/useSpeaking';

export interface VideoTileProps {
  participant: RemoteParticipant | LocalParticipant;
  videoTrack?: TrackPublication;
  audioTrack?: TrackPublication;
  screenTrack?: TrackPublication;
  isLocal?: boolean;
  isReplayBufferActive?: boolean;
  onToggleFullscreen?: () => void;
  isSpotlighted?: boolean;
  isPlaceholder?: boolean;
  placeholderType?: 'camera' | 'screen';
  onWatch?: () => void;
  onStopWatching?: () => void;
}

const VideoTile: React.FC<VideoTileProps> = ({
  participant,
  videoTrack,
  audioTrack,
  screenTrack,
  isLocal = false,
  isReplayBufferActive = false,
  onToggleFullscreen,
  isSpotlighted = false,
  isPlaceholder = false,
  placeholderType,
  onWatch,
  onStopWatching,
}) => {
  const theme = useTheme();
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const { isSpeaking } = useSpeaking();

  // Discord-style speaking ring: constant transparent border swapped to the
  // positive status color while speaking, so the ring never shifts layout.
  // Applied to camera and avatar/placeholder tiles only — never screen shares.
  const speakingRingSx = (active: boolean) => ({
    border: active
      ? `2px solid ${theme.palette.semantic.status.positive}`
      : '2px solid transparent',
    transition: 'border-color 0.2s ease',
  });
  // Handle video track
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !videoTrack) return;

    const track = videoTrack.track as VideoTrack;
    if (track) {
      track.attach(videoElement);
      videoElement.play().catch(() => {
        // Ignore autoplay errors - browser policy might block auto-play
      });
      return () => {
        track.detach(videoElement);
      };
    }
  }, [videoTrack, videoTrack?.track]);

  // Handle screen share track
  useEffect(() => {
    const screenElement = screenRef.current;
    if (!screenElement || !screenTrack) return;

    const track = screenTrack.track as VideoTrack;
    if (track) {
      track.attach(screenElement);
      screenElement.play().catch(() => {
        // Ignore autoplay errors
      });
      return () => {
        track.detach(screenElement);
      };
    }
  }, [screenTrack, screenTrack?.track]);

  const hasVideo = videoTrack && !videoTrack.isMuted;
  const hasScreen = screenTrack && !screenTrack.isMuted;
  const hasAudio = audioTrack && !audioTrack.isMuted;
  const displayName = participant.name || participant.identity;
  const isSharing = hasScreen;

  // Placeholder tile for unwatched streams — whole tile is clickable
  if (isPlaceholder && onWatch) {
    return (
      <Card
        sx={{
          position: 'relative',
          width: '100%',
          height: '100%',
          backgroundColor: 'grey.900',
          overflow: 'hidden',
          cursor: 'pointer',
          ...speakingRingSx(placeholderType !== 'screen' && isSpeaking(participant.identity)),
          transition: 'background-color 0.15s, border-color 0.2s ease',
          '&:hover': {
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
          },
        }}
        onClick={onWatch}
        role="button"
        tabIndex={0}
        aria-label={isLocal
          ? `Show your ${placeholderType === 'screen' ? 'screen share' : 'camera'}`
          : `Watch ${displayName} ${placeholderType === 'screen' ? 'screen share' : 'camera'}`
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onWatch();
          }
        }}
      >
        <Box
          sx={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
          }}
        >
          <Box sx={{ height: 'min(120px, 45%)', aspectRatio: '1 / 1', flexShrink: 1, minHeight: 32 }}>
            <UserAvatar userId={participant.identity} displayName={participant.name} size="fluid" />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: '100%', minWidth: 0 }}>
            <Typography variant="caption" noWrap sx={{ color: 'grey.300', fontWeight: 'bold', minWidth: 0 }}>
              {displayName}
            </Typography>
            {placeholderType === 'screen' ? (
              <ScreenShare sx={{ fontSize: 'icon.sm', color: 'grey.500' }} />
            ) : (
              <Videocam sx={{ fontSize: 'icon.sm', color: 'grey.500' }} />
            )}
          </Box>
          <Typography variant="caption" sx={{ color: 'grey.600', fontSize: 'scale.xs' }}>
            {isLocal ? 'Click to show' : 'Click to watch'}
          </Typography>
        </Box>
      </Card>
    );
  }

  return (
    <Card
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: 'grey.900',
        overflow: 'hidden',
        cursor: onToggleFullscreen ? 'pointer' : 'default',
        ...speakingRingSx(!hasScreen && isSpeaking(participant.identity)),
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onToggleFullscreen}
    >
      {hasScreen ? (
        <video
          ref={screenRef}
          autoPlay
          playsInline
          muted={isLocal}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            backgroundColor: 'black',
          }}
        />
      ) : hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          style={{
            width: '100%',
            height: '100%',
            objectFit: isSpotlighted ? 'contain' : 'cover',
            backgroundColor: 'black',
          }}
        />
      ) : (
        <Box
          sx={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'grey.800',
          }}
        >
          <Box sx={{ height: 'min(120px, 60%)', aspectRatio: '1 / 1', flexShrink: 1, minHeight: 32 }}>
            <UserAvatar userId={participant.identity} displayName={participant.name} size="fluid" />
          </Box>
        </Box>
      )}

      {/* Overlay Controls */}
      <Fade in={isHovered || !hasVideo}>
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundImage: `linear-gradient(transparent, ${alpha(theme.palette.background.paper, 0.85)})`,
            p: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1, mr: 1 }}>
            <Typography
              variant="caption"
              noWrap
              sx={{
                color: 'white',
                fontWeight: 'bold',
                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                minWidth: 0,
              }}
            >
              {displayName} {isLocal && '(You)'} {isSharing && ' - Screen'}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {/* Audio indicator */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                borderRadius: '50%',
                backgroundColor: hasAudio ? alpha(theme.palette.semantic.status.positive, 0.8) : alpha(theme.palette.semantic.status.negative, 0.8),
              }}
            >
              {hasAudio ? (
                <Mic sx={{ fontSize: 'icon.xs', color: 'white' }} />
              ) : (
                <MicOff sx={{ fontSize: 'icon.xs', color: 'white' }} />
              )}
            </Box>

            {/* Video/Screen share indicator */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                borderRadius: '50%',
                backgroundColor: (hasVideo || hasScreen) ? alpha(theme.palette.semantic.status.positive, 0.8) : alpha(theme.palette.semantic.status.negative, 0.8),
              }}
            >
              {hasScreen ? (
                <ScreenShare sx={{ fontSize: 'icon.xs', color: 'white' }} />
              ) : hasVideo ? (
                <Videocam sx={{ fontSize: 'icon.xs', color: 'white' }} />
              ) : (
                <VideocamOff sx={{ fontSize: 'icon.xs', color: 'white' }} />
              )}
            </Box>
          </Box>
        </Box>
      </Fade>

      {/* Action buttons - top right */}
      <Fade in={isHovered || isSpotlighted}>
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'flex',
            gap: 0.5,
          }}
        >
          {/* Stop watching / hide tile button */}
          {onStopWatching && (
            <Tooltip title={isLocal ? "Hide" : "Stop watching"}>
              <IconButton
                sx={{
                  backgroundColor: alpha(theme.palette.background.paper, 0.5),
                  color: theme.palette.common.white,
                  width: 32,
                  height: 32,
                  '&:hover': {
                    backgroundColor: alpha(theme.palette.semantic.status.negative, 0.8),
                  },
                }}
                size="small"
                aria-label={isLocal ? "Hide tile" : "Stop watching"}
                onClick={(e) => {
                  e.stopPropagation();
                  onStopWatching();
                }}
              >
                <VisibilityOff fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {/* Screenshare volume control */}
          {hasScreen && !isLocal && (
            <ScreenShareVolumeControl participant={participant as RemoteParticipant} />
          )}
        </Box>
      </Fade>

      {/* Recording indicator - top left (only for local screen share) */}
      {isLocal && isSharing && isReplayBufferActive && (
        <Box
          sx={{
            position: 'absolute',
            top: 12,
            left: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            backgroundColor: alpha(theme.palette.background.paper, 0.7),
            borderRadius: 1,
            px: 1,
            py: 0.5,
          }}
        >
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
          <Typography
            variant="caption"
            sx={{
              color: 'white',
              fontWeight: 'bold',
              fontSize: 'scale.sm',
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
            }}
          >
            Replay Available
          </Typography>
        </Box>
      )}
    </Card>
  );
};

export default VideoTile;
