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
  Videocam,
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
import { useResponsive } from '../../hooks/useResponsive';
import { setScreenShareFocused } from '../../utils/screenShareViewQuality';
import { voiceTileColor } from '../../utils/voiceTileColor';
import { voiceStatusBadges } from './components/voiceUserState';
import { VoiceStatusBadges } from './components/VoiceStatusBadges';

/**
 * The avatar's initial scales with the avatar (container-query height units),
 * not the type scale: a 128px circle with a 20px letter looks empty.
 */
const AVATAR_INITIAL_SCALE = '42cqh';

/** Is this participant deafened, per their LiveKit metadata (`{ isDeafened }`). */
function isParticipantDeafened(participant: { metadata?: string }): boolean {
  if (!participant.metadata) return false;
  try {
    return Boolean(JSON.parse(participant.metadata)?.isDeafened);
  } catch {
    return false;
  }
}

export interface VideoTileProps {
  participant: RemoteParticipant | LocalParticipant;
  videoTrack?: TrackPublication;
  audioTrack?: TrackPublication;
  screenTrack?: TrackPublication;
  isLocal?: boolean;
  isReplayBufferActive?: boolean;
  onToggleFullscreen?: () => void;
  isSpotlighted?: boolean;
  /**
   * The tile is the main view (spotlight, or the pinned tile of the sidebar
   * layout): a remote screen share in it asks for its top simulcast layer.
   */
  isFocused?: boolean;
  isPlaceholder?: boolean;
  placeholderType?: 'camera' | 'screen';
  onWatch?: () => void;
  onStopWatching?: () => void;
  /** Server-muted by a moderator (from voice presence; LiveKit doesn't carry it). */
  isServerMuted?: boolean;
  /** Smaller type and avatar, for thumbnails (solo-call corner tile). */
  compact?: boolean;
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
  isFocused = false,
  isPlaceholder = false,
  placeholderType,
  onWatch,
  onStopWatching,
  isServerMuted = false,
  compact = false,
}) => {
  const theme = useTheme();
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const { isSpeaking } = useSpeaking();
  // Touch layouts never hover, so the name/status strip stays visible there.
  const { shouldUseTouchUI } = useResponsive();

  // Speaking: the tile edge turns the positive colour AND glows (the border
  // is always 2px — transparent when quiet — so it never shifts layout). On
  // avatar tiles the avatar also gets a 3px ring (see below). Never on screen
  // shares. The glow pulses, except under prefers-reduced-motion.
  const positive = theme.palette.semantic.status.positive;
  const speakingRingSx = (active: boolean) => ({
    border: active ? `2px solid ${positive}` : '2px solid transparent',
    boxShadow: active
      ? `inset 0 0 0 1px ${positive}, 0 0 18px ${alpha(positive, 0.45)}`
      : 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    ...(active && {
      animation: 'voiceTileGlow 1.6s ease-in-out infinite',
      '@keyframes voiceTileGlow': {
        '0%, 100%': { boxShadow: `inset 0 0 0 1px ${positive}, 0 0 10px ${alpha(positive, 0.3)}` },
        '50%': { boxShadow: `inset 0 0 0 1px ${positive}, 0 0 22px ${alpha(positive, 0.55)}` },
      },
      '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
    }),
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

  // A focused screen share gets its top layer even when it's bigger than this
  // screen (adaptiveStream would otherwise pick the layer that fits the element).
  useEffect(() => {
    if (!isFocused || !screenTrack?.track) return;
    const track = screenTrack.track;
    setScreenShareFocused(track, true);
    return () => setScreenShareFocused(track, false);
  }, [isFocused, screenTrack, screenTrack?.track]);

  const hasVideo = videoTrack && !videoTrack.isMuted;
  const hasScreen = screenTrack && !screenTrack.isMuted;
  const hasAudio = audioTrack && !audioTrack.isMuted;
  const displayName = participant.name || participant.identity;
  const isSharing = hasScreen;
  const speaking = isSpeaking(participant.identity);
  // Only the unusual: self-muted (grey), server-muted (red), deafened (grey).
  const badges = voiceStatusBadges({
    isMuted: !hasAudio,
    isDeafened: isParticipantDeafened(participant),
    isServerMuted,
  });
  const tint = voiceTileColor(participant.identity);

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
          // Video-only: just the screen-share video track is attached here
          // (livekit's attach() mutes an element with no audio track anyway);
          // remote audio plays through AudioRenderer.
          muted
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
          // Video-only: just the camera track is attached (see above).
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: isSpotlighted ? 'contain' : 'cover',
            backgroundColor: 'black',
          }}
        />
      ) : (
        <Box
          data-testid="voice-avatar-tile"
          sx={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: compact ? 0.5 : 1.5,
            px: 1,
            boxSizing: 'border-box',
            backgroundColor: 'grey.900',
            backgroundImage: `radial-gradient(circle at 50% 42%, ${alpha(tint, 0.32)}, ${alpha(tint, 0.12)} 70%)`,
          }}
        >
          <Box
            data-testid="voice-tile-avatar"
            data-speaking={speaking ? 'true' : 'false'}
            sx={{
              height: compact ? 'min(64px, 55%)' : 'min(128px, 50%)',
              aspectRatio: '1 / 1',
              flexShrink: 1,
              minHeight: 28,
              borderRadius: '50%',
              // Size the initial with the avatar (container query units)
              containerType: 'size',
              '& .MuiAvatar-root': { fontSize: AVATAR_INITIAL_SCALE },
              boxShadow: speaking ? `0 0 0 3px ${positive}` : '0 0 0 3px transparent',
              transition: 'box-shadow 0.15s ease',
            }}
          >
            <UserAvatar
              userId={participant.identity}
              displayName={participant.name}
              size="fluid"
              fallbackColor={tint}
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: '100%', minWidth: 0 }}>
            <Typography
              variant={compact ? 'caption' : 'body2'}
              noWrap
              sx={{ color: 'grey.100', fontWeight: 600, minWidth: 0 }}
            >
              {displayName}{isLocal && ' (You)'}
            </Typography>
            <VoiceStatusBadges badges={badges} size={compact ? 14 : 16} />
          </Box>
        </Box>
      )}

      {/* Name + unusual states, over video only (avatar tiles show them under the avatar) */}
      {(hasVideo || hasScreen) && (
      <Fade in={isHovered || shouldUseTouchUI}>
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundImage: `linear-gradient(transparent, ${alpha(theme.palette.common.black, 0.7)})`,
            p: 1,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flex: 1 }}>
            <Typography
              variant="body2"
              noWrap
              sx={{
                color: 'white',
                fontWeight: 600,
                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                minWidth: 0,
              }}
            >
              {displayName} {isLocal && '(You)'} {isSharing && ' - Screen'}
            </Typography>
            <VoiceStatusBadges badges={badges} size={16} />
          </Box>
        </Box>
      </Fade>
      )}

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
