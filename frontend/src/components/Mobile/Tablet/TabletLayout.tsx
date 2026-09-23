/**
 * TabletLayout Component
 *
 * Split-view layout for tablets (768-1199px).
 * Sidebar on the left (navigation header + channel list), content on the
 * right. Tablet navigates with the sidebar only — there is no bottom nav.
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
import MobileCommunityDrawer from '../Navigation/MobileCommunityDrawer';
import { TabletSidebar } from './TabletSidebar';
import { TabletContentArea } from './TabletContentArea';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_TOP,
  useKeyboardInset,
  useTopChromeHost,
} from '../../../contexts/BottomChromeContext';

/**
 * Inner layout component that has access to navigation context
 */
const TabletLayoutInner: React.FC = () => {
  const { state, lastCommunityId } = useMobileNavigation();

  // Attempt to recover voice connection after page refresh
  useVoiceRecovery();

  // Edge chrome (BottomChromeContext): top padding for the offline strip /
  // call banner; the voice bar in normal flow at the bottom. With no bottom
  // nav, the column itself pads the home-indicator area (not while the
  // keyboard is open — it covers that area).
  const topChromeHeight = useTopChromeHost();
  const keyboardOpen = useKeyboardInset() > 0;

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
        paddingBottom: keyboardOpen ? 0 : SAFE_AREA_BOTTOM,
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
            {/* Sidebar - navigation + channel list, visible on every screen.
                On DM / notification / profile screens (no community in the
                route) it keeps showing the last community's channels. */}
            <TabletSidebar communityId={state.communityId ?? lastCommunityId} />

            {/* Content area */}
            <TabletContentArea showSidebar />
          </Box>

          {/* Voice bar (only shows when in call) — in flow at the bottom */}
          <VoiceBottomBar inline />

          {/* Audio renderer for remote participants */}
          <AudioRenderer />

          {/* Floating video overlay */}
          <PersistentVideoOverlay />
        </VoiceEventLogProvider>
      </TrackSubscriptionProvider>
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
