/**
 * TabletLayout Component
 *
 * Split-view layout for tablets (768-1199px).
 * Shows channel list on left, content on right.
 * Sidebar on left, main content on right.
 */

import React from 'react';
import { Box } from '@mui/material';
import { useVoiceConnection } from '../../../hooks/useVoiceConnection';
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
import { LAYOUT_CONSTANTS } from '../../../utils/breakpoints';

/**
 * Inner layout component that has access to navigation context
 */
const TabletLayoutInner: React.FC = () => {
  const { state: voiceState } = useVoiceConnection();
  const { state } = useMobileNavigation();

  // Attempt to recover voice connection after page refresh
  useVoiceRecovery();

  const hasVoiceBar = voiceState.isConnected;

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
        paddingTop: 'env(safe-area-inset-top)',
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
              display: 'flex',
              overflow: 'hidden',
            }}
          >
            {/* Sidebar - channel list (only visible on home tab with community selected) */}
            {showSidebar && state.communityId && (
              <TabletSidebar communityId={state.communityId} />
            )}

            {/* Content area */}
            <TabletContentArea
              showSidebar={showSidebar && !!state.communityId}
              bottomOffset={hasVoiceBar ? LAYOUT_CONSTANTS.VOICE_BAR_HEIGHT_MOBILE : 0}
            />
          </Box>

          {/* Voice bar (only shows when in call) */}
          {hasVoiceBar && <VoiceBottomBar />}

          {/* Audio renderer for remote participants */}
          <AudioRenderer />

          {/* Floating video overlay */}
          <PersistentVideoOverlay />
        </VoiceEventLogProvider>
      </TrackSubscriptionProvider>

      {/* Bottom navigation - always visible */}
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
