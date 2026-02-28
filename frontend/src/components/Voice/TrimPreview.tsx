import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Box,
  CircularProgress,
  Alert,
  IconButton,
  Chip,
  Tooltip,
  Button,
} from '@mui/material';
import {
  PlayArrow,
  Pause,
  Replay,
  SkipPrevious,
  SkipNext,
  Refresh,
} from '@mui/icons-material';
import Hls from 'hls.js';
import { getApiUrl } from '../../config/env';
import { getAccessToken } from '../../utils/tokenService';
import { useQuery } from '@tanstack/react-query';
import { ServerEvents } from '@kraken/shared';
import { livekitControllerGetSessionInfoOptions } from '../../api-client/@tanstack/react-query.gen';
import { useServerEvent } from '../../socket-hub/useServerEvent';
import { logger } from '../../utils/logger';
import { useResponsive } from '../../hooks/useResponsive';
import TrimTimeline from './TrimTimeline';

interface TrimPreviewProps {
  onRangeChange: (startSeconds: number, endSeconds: number) => void;
}

export const TrimPreview: React.FC<TrimPreviewProps> = ({ onRangeChange }) => {
  const { isMobile } = useResponsive();

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(false);

  // Trim range state
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(60);
  const [isDragging, setIsDragging] = useState<'start' | 'end' | null>(null);

  const isInitializedRef = useRef(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Refs to avoid stale closures in event handlers
  const startTimeRef = useRef(startTime);
  const endTimeRef = useRef(endTime);
  const loopEnabledRef = useRef(loopEnabled);

  // Keep refs in sync with state
  useEffect(() => {
    startTimeRef.current = startTime;
  }, [startTime]);

  useEffect(() => {
    endTimeRef.current = endTime;
  }, [endTime]);

  useEffect(() => {
    loopEnabledRef.current = loopEnabled;
  }, [loopEnabled]);

  // Snapshot maxDuration so the timeline doesn't shift while the user is trimming.
  // Only updated on initial load or when the user clicks "Refresh segments".
  const [maxDuration, setMaxDuration] = useState(0);

  const { data: sessionInfo, isLoading: sessionLoading, refetch: refetchSessionInfo } = useQuery({
    ...livekitControllerGetSessionInfoOptions(),
    staleTime: 0, // Always refetch on mount
    refetchOnWindowFocus: false, // Don't refetch when user returns to tab (would shift timeline)
    refetchInterval: false, // No polling — use WebSocket event + manual refresh
  });

  // Listen for WebSocket push when segments become available (initial load only)
  useServerEvent(ServerEvents.EGRESS_SEGMENTS_READY, useCallback(() => {
    if (!isInitializedRef.current) {
      refetchSessionInfo();
    }
  }, [refetchSessionInfo]));

  // Initialize range and snapshot maxDuration when session info first loads
  useEffect(() => {
    if (sessionInfo?.totalDurationSeconds && !isInitializedRef.current) {
      const maxDur = sessionInfo.totalDurationSeconds;
      setMaxDuration(maxDur);
      // Default to last 60 seconds or full buffer if less
      const defaultStart = Math.max(0, maxDur - 60);
      setStartTime(defaultStart);
      setEndTime(maxDur);
      onRangeChange(defaultStart, maxDur);
      isInitializedRef.current = true;
      setIsInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionInfo?.totalDurationSeconds]);

  // Initialize HLS.js player
  useEffect(() => {
    if (!videoRef.current || !sessionInfo?.hasActiveSession || !maxDuration) return;

    const video = videoRef.current;
    // HLS.js sends Authorization header via xhrSetup; Safari native uses cookie auth
    const playlistUrl = getApiUrl('/livekit/replay/preview/playlist.m3u8');

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        // Force remux even for unusual MPEG-TS formats
        progressive: false,
        // Relax parsing strictness for HDMV-style MPEG-TS
        stretchShortVideoTrack: true,
        forceKeyFrameOnDiscontinuity: true,
        xhrSetup: (xhr, _url) => {
          // Send cookies for same-origin requests
          xhr.withCredentials = true;
          // Also set Authorization header as backup (more reliable for XHR)
          const token = getAccessToken();
          if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          }
        },
      });

      hls.loadSource(playlistUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        // Wait for video to be ready before seeking
        const seekToStart = () => {
          // Use the ref to get the current startTime value (set by first effect)
          const targetTime = startTimeRef.current;
          logger.dev('HLS: Seeking to start time:', targetTime);
          video.currentTime = targetTime;
          setCurrentTime(targetTime);
        };

        // Check if video is ready, if not wait for canplay event
        if (video.readyState >= 3) {
          seekToStart();
        } else {
          const handleCanPlay = () => {
            seekToStart();
            video.removeEventListener('canplay', handleCanPlay);
          };
          video.addEventListener('canplay', handleCanPlay);
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        logger.error('HLS Error:', data);
        // Log fragment details for debugging demuxer issues
        if (data.frag) {
          logger.error('Fragment details:', {
            sn: data.frag.sn,
            url: data.frag.url,
            start: data.frag.start,
            duration: data.frag.duration,
          });
        }
        if (data.fatal) {
          let errorMessage = `Failed to load video preview: ${data.type}`;
          if (data.details) {
            errorMessage += ` (${data.details})`;
          }
          if (data.response?.code) {
            errorMessage += ` - HTTP ${data.response.code}`;
          }
          setError(errorMessage);
          setIsLoading(false);
        }
      });

      // Debug: Log when fragments are loaded successfully
      hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
        logger.dev('Fragment loaded:', {
          sn: data.frag.sn,
          url: data.frag.url,
          size: data.frag.stats.total,
        });
      });

      hlsRef.current = hls;

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS - uses cookie-based auth (same-origin)
      video.src = playlistUrl;
      const handleLoadedMetadata = () => {
        setIsLoading(false);
        const seekToStart = () => {
          const targetTime = startTimeRef.current;
          video.currentTime = targetTime;
          setCurrentTime(targetTime);
        };

        if (video.readyState >= 3) {
          seekToStart();
        } else {
          const handleCanPlay = () => {
            seekToStart();
            video.removeEventListener('canplay', handleCanPlay);
          };
          video.addEventListener('canplay', handleCanPlay);
        }
      };
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      video.addEventListener('error', () => {
        setError('Failed to load video preview');
        setIsLoading(false);
      });
    } else {
      setError('HLS playback is not supported in this browser');
      setIsLoading(false);
    }
  }, [sessionInfo?.hasActiveSession, isInitialized, retryKey]);

  // Handle video time update - constrain to selection
  // This effect depends on isLoading to ensure it runs AFTER HLS is initialized
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isLoading) return; // Wait until HLS is loaded

    logger.dev('Attaching timeupdate listener to video element');

    const handleTimeUpdate = () => {
      const time = video.currentTime;

      // Update current time on every frame for smooth playhead movement
      setCurrentTime(time);

      // Stop or loop at end of selection - use refs for current values
      // Add small buffer (0.1s) to avoid race conditions with ref updates
      if (time >= endTimeRef.current - 0.1) {
        if (loopEnabledRef.current) {
          logger.dev('Looping back to start:', startTimeRef.current);
          video.currentTime = startTimeRef.current;
        } else {
          video.pause();
          setIsPlaying(false);
        }
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      logger.dev('Removing timeupdate listener');
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [isLoading]); // Re-attach when loading completes

  // Playback controls with video readiness checks
  const handlePlaySelection = () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;
    videoRef.current.currentTime = startTime;
    videoRef.current.play().catch((err) => {
      logger.error('Failed to play:', err);
    });
    setIsPlaying(true);
  };

  const handleTogglePlay = () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch((err) => {
        logger.error('Failed to play:', err);
      });
      setIsPlaying(true);
    }
  };

  const handleJumpToStart = () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;
    videoRef.current.currentTime = startTime;
    setCurrentTime(startTime);
  };

  const handleJumpToEnd = () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;
    videoRef.current.currentTime = Math.max(startTime, endTime - 1);
    setCurrentTime(endTime - 1);
  };

  // Timeline drag handlers
  const handleTimelineMouseDown = useCallback(
    (e: React.MouseEvent, handle: 'start' | 'end') => {
      e.preventDefault();
      setIsDragging(handle);
    },
    []
  );

  const handleTimelineMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !timelineRef.current) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percentage = x / rect.width;
      const newTime = Math.round(percentage * maxDuration); // 1-second precision

      if (isDragging === 'start') {
        const newStart = Math.min(newTime, endTime - 1);
        setStartTime(newStart);
        onRangeChange(newStart, endTime);
        if (videoRef.current && currentTime < newStart) {
          videoRef.current.currentTime = newStart;
        }
      } else {
        const newEnd = Math.max(newTime, startTime + 1);
        setEndTime(newEnd);
        onRangeChange(startTime, newEnd);
      }
    },
    [isDragging, maxDuration, startTime, endTime, currentTime, onRangeChange]
  );

  const handleTimelineMouseUp = useCallback(() => {
    setIsDragging(null);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleTimelineMouseMove);
      window.addEventListener('mouseup', handleTimelineMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleTimelineMouseMove);
        window.removeEventListener('mouseup', handleTimelineMouseUp);
      };
    }
  }, [isDragging, handleTimelineMouseMove, handleTimelineMouseUp]);

  // Retry loading HLS after error
  const handleRetry = useCallback(() => {
    setError(null);
    setIsLoading(true);
    // Destroy existing HLS instance if any
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    // Increment retry key to trigger useEffect re-run
    setRetryKey((prev) => prev + 1);
  }, []);

  // Refresh segments - manually refetch session info and reload HLS
  // This is the ONLY path that updates maxDuration after initialization,
  // so the timeline stays stable while the user is actively trimming.
  const handleRefreshSegments = useCallback(async () => {
    const { data: updated } = await refetchSessionInfo();
    if (updated?.totalDurationSeconds) {
      const newMax = updated.totalDurationSeconds;
      setMaxDuration(newMax);
      // If end time was at the previous max, extend it to the new max
      setEndTime((prev) => {
        const wasAtMax = prev >= maxDuration;
        const newEnd = wasAtMax ? newMax : prev;
        onRangeChange(startTime, newEnd);
        return newEnd;
      });
    }
    handleRetry();
  }, [refetchSessionInfo, maxDuration, startTime, onRangeChange, handleRetry]);

  // Click on timeline to seek (anywhere on the timeline, not just within selection)
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!timelineRef.current || !videoRef.current || isDragging) return;
    if (videoRef.current.readyState < 2) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < 0 || x > rect.width) return;

    const percentage = x / rect.width;
    const clickTime = Math.max(0, Math.min(maxDuration, percentage * maxDuration));
    videoRef.current.currentTime = clickTime;
    setCurrentTime(clickTime);
  };

  if (sessionLoading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (!sessionInfo?.hasActiveSession) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        No active replay buffer. Start screen sharing to enable custom trimming.
      </Alert>
    );
  }

  if (maxDuration === 0) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        Waiting for buffer to accumulate segments...
      </Alert>
    );
  }

  return (
    <Box sx={{ mt: 2 }}>
      {/* Large Video Preview */}
      <Box
        sx={{
          position: 'relative',
          backgroundColor: 'black',
          borderRadius: 1,
          overflow: 'hidden',
          mb: 2,
        }}
      >
        {isLoading && (
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 1,
            }}
          >
            <CircularProgress />
          </Box>
        )}
        {error && (
          <Alert
            severity="error"
            sx={{ m: 1 }}
            action={
              <Button color="inherit" size="small" onClick={handleRetry}>
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        )}
        <video
          ref={videoRef}
          style={{
            width: '100%',
            height: isMobile ? 'auto' : 'calc(90vh - 350px)', // Auto height on mobile
            minHeight: isMobile ? '200px' : '400px',
            maxHeight: isMobile ? '40vh' : '70vh',
            objectFit: 'contain',
            display: 'block',
          }}
          crossOrigin="use-credentials"
          aria-label="Replay buffer preview"
        />
      </Box>

      {/* Playback Controls */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          mb: 2,
        }}
      >
        <Tooltip title="Jump to start">
          <IconButton onClick={handleJumpToStart} size="small" aria-label="Jump to start of selection">
            <SkipPrevious />
          </IconButton>
        </Tooltip>
        <Tooltip title={isPlaying ? 'Pause' : 'Play'}>
          <IconButton onClick={handleTogglePlay} size="small" aria-label={isPlaying ? 'Pause playback' : 'Play video'}>
            {isPlaying ? <Pause /> : <PlayArrow />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Play selection from start">
          <IconButton onClick={handlePlaySelection} color="primary" aria-label="Play selection from start">
            <Replay />
          </IconButton>
        </Tooltip>
        <Tooltip title="Jump to end">
          <IconButton onClick={handleJumpToEnd} size="small" aria-label="Jump to end of selection">
            <SkipNext />
          </IconButton>
        </Tooltip>
        <Chip
          label={loopEnabled ? 'Loop ON' : 'Loop OFF'}
          onClick={() => setLoopEnabled(!loopEnabled)}
          color={loopEnabled ? 'primary' : 'default'}
          size="small"
          sx={{ ml: 2 }}
          aria-pressed={loopEnabled}
          role="switch"
          aria-label="Toggle loop playback"
        />
        <Tooltip title="Refresh segments">
          <IconButton onClick={handleRefreshSegments} size="small" aria-label="Refresh segments">
            <Refresh />
          </IconButton>
        </Tooltip>
      </Box>

      <TrimTimeline
        startTime={startTime}
        endTime={endTime}
        currentTime={currentTime}
        maxDuration={maxDuration}
        isMobile={isMobile}
        onTimelineMouseDown={handleTimelineMouseDown}
        onTimelineClick={handleTimelineClick}
        timelineRef={timelineRef}
      />
    </Box>
  );
};
