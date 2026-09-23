import React, { Suspense, lazy } from 'react';
import { Box, IconButton } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Close } from '@mui/icons-material';
import { useVoice } from '../../contexts/VoiceContext';
import { useVoiceConnection } from '../../hooks/useVoiceConnection';
import { useResponsive } from '../../hooks/useResponsive';
import { VOICE_BAR_HEIGHT_MOBILE } from '../../constants/layout';

// VideoTiles and FloatCard pull in livekit-client runtime enums; lazy-load
// them so they're only fetched once video is actually shown (see PR-11 bundle
// splitting). This component itself is always mounted in the layouts, but
// returns null unless voiceState.isConnected && voiceState.showVideoTiles.
const VideoTiles = lazy(() => import('./VideoTiles').then((m) => ({ default: m.VideoTiles })));
const FloatCard = lazy(() => import('./FloatCard').then((m) => ({ default: m.FloatCard })));

export const PersistentVideoOverlay: React.FC = () => {
  const theme = useTheme();
  const voiceState = useVoice();
  const { actions } = useVoiceConnection();
  const { isMobile } = useResponsive();

  // Only show if connected AND video tiles are enabled
  // Note: We show the overlay when video tiles are enabled (not just when camera is on)
  // because remote participants may have video even if local user doesn't
  const shouldShow = voiceState.isConnected && voiceState.showVideoTiles;

  if (!shouldShow) {
    return null;
  }

  // The embedded stage already renders the session's video; suppress the
  // floating overlay so the same tiles aren't shown twice on desktop.
  if (!isMobile && voiceState.stageMounted) {
    return null;
  }

  // Mobile: simplified full-screen overlay (no drag/resize)
  if (isMobile) {
    return (
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: VOICE_BAR_HEIGHT_MOBILE,
          zIndex: 1200,
          backgroundColor: 'grey.900',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Close button */}
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 1,
          }}
        >
          <IconButton
            size="small"
            onClick={() => actions.setShowVideoTiles(false)}
            sx={{
              backgroundColor: alpha(theme.palette.background.paper, 0.7),
              color: theme.palette.text.primary,
              '&:hover': {
                backgroundColor: alpha(theme.palette.background.paper, 0.9),
              },
            }}
          >
            <Close fontSize="small" />
          </IconButton>
        </Box>

        {/* Video content */}
        <Box sx={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <Suspense fallback={null}>
            <VideoTiles />
          </Suspense>
        </Box>
      </Box>
    );
  }

  // Desktop: active-speaker float card (drag/resize/minimize + single-tile
  // selection all live in FloatCard).
  return (
    <Suspense fallback={null}>
      <FloatCard />
    </Suspense>
  );
};

export default PersistentVideoOverlay;
