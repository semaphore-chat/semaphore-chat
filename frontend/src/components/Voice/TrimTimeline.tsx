import React from 'react';
import { Box, Typography } from '@mui/material';
import { formatPlaybackTime } from '../../utils/format';

interface TrimTimelineProps {
  startTime: number;
  endTime: number;
  currentTime: number;
  maxDuration: number;
  isMobile: boolean;
  onTimelineMouseDown: (e: React.MouseEvent, handle: 'start' | 'end') => void;
  onTimelineClick: (e: React.MouseEvent) => void;
  timelineRef: React.RefObject<HTMLDivElement | null>;
}

const TrimTimeline: React.FC<TrimTimelineProps> = ({
  startTime,
  endTime,
  currentTime,
  maxDuration,
  isMobile,
  onTimelineMouseDown,
  onTimelineClick,
  timelineRef,
}) => {
  const selectedDuration = endTime - startTime;
  const startPercent = (startTime / maxDuration) * 100;
  const endPercent = (endTime / maxDuration) * 100;
  const playheadPercent = (currentTime / maxDuration) * 100;

  // Generate time ruler marks
  const timeMarks: number[] = [];
  const markInterval = maxDuration > 300 ? 60 : 30; // 60s marks for >5min, else 30s
  for (let t = 0; t <= maxDuration; t += markInterval) {
    timeMarks.push(t);
  }

  return (
    <>
      {/* Time Ruler */}
      <Box sx={{ position: 'relative', height: 20, mb: 0.5 }}>
        {timeMarks.map((t) => (
          <Typography
            key={t}
            variant="caption"
            sx={{
              position: 'absolute',
              left: `${(t / maxDuration) * 100}%`,
              transform: 'translateX(-50%)',
              color: 'text.secondary',
              fontSize: 'scale.2xs',
            }}
          >
            {formatPlaybackTime(t)}
          </Typography>
        ))}
      </Box>

      {/* Visual Timeline */}
      <Box
        ref={timelineRef}
        onClick={onTimelineClick}
        sx={{
          position: 'relative',
          height: isMobile ? 100 : 80, // Taller on mobile for easier touch targets
          backgroundColor: 'grey.900',
          borderRadius: 2,
          cursor: 'pointer',
          overflow: 'hidden',
          userSelect: 'none',
          border: '1px solid',
          borderColor: 'grey.700',
        }}
      >
        {/* Full buffer background with subtle pattern */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'grey.800',
            backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 50px, rgba(255,255,255,0.02) 50px, rgba(255,255,255,0.02) 51px)',
          }}
        />

        {/* Dimmed areas outside selection */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: `${startPercent}%`,
            backgroundColor: 'rgba(0,0,0,0.6)',
            zIndex: 1,
            pointerEvents: 'none',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: 0,
            width: `${100 - endPercent}%`,
            backgroundColor: 'rgba(0,0,0,0.6)',
            zIndex: 1,
            pointerEvents: 'none',
          }}
        />

        {/* Selected range highlight */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${startPercent}%`,
            width: `${endPercent - startPercent}%`,
            backgroundImage: 'linear-gradient(180deg, rgba(25, 118, 210, 0.3) 0%, rgba(25, 118, 210, 0.15) 100%)',
            borderTop: '3px solid',
            borderBottom: '3px solid',
            borderColor: 'primary.main',
          }}
        />

        {/* Playhead - always visible */}
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${playheadPercent}%`,
            width: 3,
            backgroundColor: 'warning.main',
            zIndex: 5,
            boxShadow: '0 0 8px rgba(255, 167, 38, 0.6)',
            pointerEvents: 'none',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: -6,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid',
              borderTopColor: 'warning.main',
            },
          }}
        />

        {/* Start handle */}
        <Box
          onMouseDown={(e) => onTimelineMouseDown(e, 'start')}
          role="slider"
          aria-label="Trim start time"
          aria-valuemin={0}
          aria-valuemax={maxDuration}
          aria-valuenow={startTime}
          aria-valuetext={`Start at ${formatPlaybackTime(startTime)}`}
          tabIndex={0}
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${startPercent}%`,
            width: 12,
            transform: 'translateX(-50%)',
            backgroundImage: 'linear-gradient(180deg, #4caf50 0%, #2e7d32 100%)',
            cursor: 'ew-resize',
            zIndex: 6,
            borderRadius: '6px 0 0 6px',
            boxShadow: '2px 0 8px rgba(0,0,0,0.4)',
            transition: 'width 0.15s ease, box-shadow 0.15s ease',
            '&:hover': {
              width: 14,
              boxShadow: '2px 0 12px rgba(76, 175, 80, 0.6)',
            },
            '&:focus': {
              outline: '2px solid',
              outlineColor: 'primary.main',
              outlineOffset: 2,
            },
            '&::after': {
              content: '""',
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 3,
              height: 40,
              backgroundColor: 'rgba(255,255,255,0.8)',
              borderRadius: 2,
            },
          }}
        />

        {/* End handle */}
        <Box
          onMouseDown={(e) => onTimelineMouseDown(e, 'end')}
          role="slider"
          aria-label="Trim end time"
          aria-valuemin={0}
          aria-valuemax={maxDuration}
          aria-valuenow={endTime}
          aria-valuetext={`End at ${formatPlaybackTime(endTime)}`}
          tabIndex={0}
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${endPercent}%`,
            width: 12,
            transform: 'translateX(-50%)',
            backgroundImage: 'linear-gradient(180deg, #f44336 0%, #c62828 100%)',
            cursor: 'ew-resize',
            zIndex: 6,
            borderRadius: '0 6px 6px 0',
            boxShadow: '-2px 0 8px rgba(0,0,0,0.4)',
            transition: 'width 0.15s ease, box-shadow 0.15s ease',
            '&:hover': {
              width: 14,
              boxShadow: '-2px 0 12px rgba(244, 67, 54, 0.6)',
            },
            '&:focus': {
              outline: '2px solid',
              outlineColor: 'primary.main',
              outlineOffset: 2,
            },
            '&::after': {
              content: '""',
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 3,
              height: 40,
              backgroundColor: 'rgba(255,255,255,0.8)',
              borderRadius: 2,
            },
          }}
        />

        {/* Time marks on timeline */}
        {timeMarks.map((t) => (
          <Box
            key={t}
            sx={{
              position: 'absolute',
              bottom: 0,
              left: `${(t / maxDuration) * 100}%`,
              width: 1,
              height: 12,
              backgroundColor: 'rgba(255,255,255,0.3)',
            }}
          />
        ))}
      </Box>

      {/* Time Display Badges */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: isMobile ? 1.5 : 0,
          mt: 2,
          px: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, order: isMobile ? 1 : 0 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: 'success.main',
              boxShadow: '0 0 6px rgba(76, 175, 80, 0.6)',
            }}
          />
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
            Start: {formatPlaybackTime(startTime)}
          </Typography>
        </Box>
        <Box
          sx={{
            px: 2,
            py: 0.5,
            borderRadius: 2,
            backgroundColor: 'primary.main',
            color: 'primary.contrastText',
            order: isMobile ? 0 : 1,
          }}
        >
          <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
            Duration: {formatPlaybackTime(selectedDuration)}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, order: 2 }}>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
            End: {formatPlaybackTime(endTime)}
          </Typography>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: 'error.main',
              boxShadow: '0 0 6px rgba(244, 67, 54, 0.6)',
            }}
          />
        </Box>
      </Box>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', textAlign: 'center', mt: 1 }}
      >
        Drag the green and red handles to adjust your clip range. Buffer: {formatPlaybackTime(maxDuration)} total
      </Typography>
    </>
  );
};

export default TrimTimeline;
