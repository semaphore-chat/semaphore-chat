/**
 * TabletLayout Component
 *
 * Split-view layout for tablets (768-1199px).
 * Shows channel list on left, content on right.
 * Sidebar on left, main content on right.
 */

import React from 'react';
import { Box } from '@mui/material';
import { useVoiceRecovery } from '../../../hooks/useVoiceRecovery';
import { VoiceBottomBar } from '../../Voice/VoiceBottomBar';
import { AudioRenderer } from '../../Voice/AudioRenderer';
import { PersistentVideoOverlay } from '../../Voice/PersistentVideoOverlay';
import { TrackSubscriptionProvider } from '../../Voice/TrackSubscriptionProvider';
import { VoiceEventLogProvider } from '../../../hooks/useVoiceEventLog';
import { MobileNavigationProvider, useMobileNavigation } from '../Navigation/MobileNavigationContext';
import { MobileBottomNavigation } from '../Navigation/MobileBottomNavigation';
import MobileCommunityDrawer from '../Navigation/MobileCommunityDrawer';
import { TabletSidebar } from './TabletSidebar';
import { TabletContentArea } from './TabletContentArea';
import { SAFE_AREA_TOP, useTopChromeHost } from '../../../contexts/BottomChromeContext';

/**
 * Inner layout component that has access to navigation context
 */
const TabletLayoutInner: React.FC = () => {
  const { state } = useMobileNavigation();

  // Attempt to recover voice connection after page refresh
  useVoiceRecovery();

  // Edge chrome (BottomChromeContext): top padding for the offline strip /
  // call banner; voice bar and nav in normal flow at the bottom (the nav
  // pads the home-indicator area, and hides while the keyboard is open).
  const topChromeHeight = useTopChromeHost();

  // Determine if we should show the sidebar
  // Show sidebar when on home tab (channels/chat screens)
  const showSidebar =
    state.currentScreen === 'channels' || state.currentScreen === 'chat' || state.currentScreen === 'search';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'var(--full-dvh)',
        width: '100vw',
        overflow: 'hidden',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: `calc(${SAFE_AREA_TOP} + ${topChromeHeight}px)`,
      }}
    >
      {/* Community drawer - still available via swipe */}
      <MobileCommunityDrawer />

      {/* Main content area */}
      <TrackSubscriptionProvider>
        <VoiceEventLogProvider>
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              overflow: 'hidden',
            }}
          >
            {/* Sidebar - channel list (only visible on home tab with community selected) */}
            {showSidebar && state.communityId && (
              <TabletSidebar communityId={state.communityId} />
            )}

            {/* Content area */}
            <TabletContentArea showSidebar={showSidebar && !!state.communityId} />
          </Box>

          {/* Voice bar (only shows when in call) — in flow, above the nav */}
          <VoiceBottomBar inline />

          {/* Audio renderer for remote participants */}
          <AudioRenderer />

          {/* Floating video overlay */}
          <PersistentVideoOverlay />
        </VoiceEventLogProvider>
      </TrackSubscriptionProvider>

      {/* Bottom navigation (hidden while the keyboard is open) */}
      <MobileBottomNavigation />
    </Box>
  );
};

/**
 * Main tablet layout with split view
 */
export const TabletLayout: React.FC = () => {
  return (
    <MobileNavigationProvider>
      <TabletLayoutInner />
    </MobileNavigationProvider>
  );
};

export default TabletLayout;
