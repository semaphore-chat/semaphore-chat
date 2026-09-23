/**
 * MobileLayout Component
 *
 * Main mobile layout with drawer-based navigation.
 * Uses drawer + screens pattern instead of panel stack.
 *
 * Architecture:
 * - Community drawer (swipe from left edge)
 * - Screen-based navigation (max 2 levels deep)
 * - Bottom navigation tabs (hidden on chat/search screens and while the
 *   on-screen keyboard is open)
 * - Voice bar when connected
 *
 * Edge chrome (BottomChromeContext): the column stacks, top to bottom,
 * [top chrome padding] → screen → voice bar → bottom nav, all in normal flow,
 * so nothing covers the content and the screen needs no bottom padding.
 * The top padding makes room for the offline strip / incoming-call banner.
 */

import React from 'react';
import { Box } from '@mui/material';
import { useVoiceRecovery } from '../../hooks/useVoiceRecovery';
import { VoiceBottomBar } from '../Voice/VoiceBottomBar';
import { AudioRenderer } from '../Voice/AudioRenderer';
import { PersistentVideoOverlay } from '../Voice/PersistentVideoOverlay';
import { TrackSubscriptionProvider } from '../Voice/TrackSubscriptionProvider';
import { VoiceEventLogProvider } from '../../hooks/useVoiceEventLog';
import { VoiceTestHooks } from '../../features/voice/VoiceTestHooks';
import { MobileNavigationProvider } from './Navigation/MobileNavigationContext';
import { MobileBottomNavigation } from './Navigation/MobileBottomNavigation';
import { useBottomNavHidden } from './Navigation/useBottomNavHidden';
import MobileCommunityDrawer from './Navigation/MobileCommunityDrawer';
import { MobileScreenContainer } from './Screens/MobileScreenContainer';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_TOP,
  useKeyboardInset,
  useTopChromeHost,
} from '../../contexts/BottomChromeContext';

/** Inside MobileNavigationProvider: the nav's visibility depends on the screen. */
const MobileLayoutColumn: React.FC = () => {
  // Attempt to recover voice connection after page refresh
  useVoiceRecovery();

  const topChromeHeight = useTopChromeHost();
  const navHidden = useBottomNavHidden(true);
  const keyboardOpen = useKeyboardInset() > 0;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'var(--full-dvh)', // Use dynamic viewport height for mobile
        width: '100vw',
        overflow: 'hidden',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        // Safe area for notches, plus room for the offline strip / call banner.
        paddingTop: `calc(${SAFE_AREA_TOP} + ${topChromeHeight}px)`,
        // The nav pads the home-indicator area itself; without it, the column does.
        paddingBottom: navHidden && !keyboardOpen ? SAFE_AREA_BOTTOM : 0,
      }}
    >
      <TrackSubscriptionProvider>
        <VoiceEventLogProvider>
          <VoiceTestHooks />
          {/* Community drawer - swipe from left edge */}
          <MobileCommunityDrawer />

          {/* Screen container - main content area */}
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <MobileScreenContainer />
          </Box>

          {/* Voice bar (only shows when in call) — in flow, above the nav.
              Collapsed (not unmounted) while the on-screen keyboard is up, so
              typing gets the room back; the call itself is unaffected. */}
          <Box data-testid="mobile-voice-bar-slot" sx={{ display: keyboardOpen ? 'none' : 'block', flexShrink: 0 }}>
            <VoiceBottomBar inline />
          </Box>

          {/* Audio renderer for remote participants */}
          <AudioRenderer />

          {/* Floating video overlay */}
          <PersistentVideoOverlay />
        </VoiceEventLogProvider>
      </TrackSubscriptionProvider>

      {/* Bottom navigation - hidden on chat/search screens */}
      <MobileBottomNavigation hideOnDetailScreens />
    </Box>
  );
};

/**
 * Main mobile layout with drawer-based navigation
 * Drawer + Screens pattern replaces the old panel stack
 */
export const MobileLayout: React.FC = () => (
  <MobileNavigationProvider>
    <MobileLayoutColumn />
  </MobileNavigationProvider>
);
