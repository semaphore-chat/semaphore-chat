/**
 * TabletContentArea Component
 *
 * Content area for tablet layout.
 * Shows chat, DMs, notifications, or profile based on current screen.
 */

import React from 'react';
import { Outlet } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { useMobileNavigation } from '../Navigation/MobileNavigationContext';
import { MobileChatPanel } from '../Panels/MobileChatPanel';
import { MobileMessagesPanel } from '../Panels/MobileMessagesPanel';
import { MobileProfilePanel } from '../Panels/MobileProfilePanel';
import { NotificationsScreen } from '../Screens/NotificationsScreen';
import { MobileSearchScreen } from '../Screens/MobileSearchScreen';
import SettingsPage from '../../../pages/SettingsPage';
import { LAYOUT_CONSTANTS } from '../../../utils/breakpoints';
import MobileAppBar from '../MobileAppBar';

interface TabletContentAreaProps {
  showSidebar: boolean;
  bottomOffset?: number;
}

/**
 * Content area that renders based on current screen
 */
export const TabletContentArea: React.FC<TabletContentAreaProps> = ({
  showSidebar,
  bottomOffset = 0,
}) => {
  const { state } = useMobileNavigation();
  const { currentScreen, communityId, channelId, dmGroupId, userId } = state;

  const totalBottomOffset = LAYOUT_CONSTANTS.BOTTOM_NAV_HEIGHT_MOBILE + bottomOffset;

  const renderContent = () => {
    switch (currentScreen) {
      case 'channels':
        // On tablet with sidebar, show welcome message if no channel selected
        if (showSidebar && !channelId) {
          return (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: 2,
                p: 3,
                textAlign: 'center',
              }}
            >
              <Typography variant="h5" color="text.secondary">
                Select a channel
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Choose a channel from the sidebar to start chatting
              </Typography>
            </Box>
          );
        }
        // If no sidebar (no community), show empty state
        if (!communityId) {
          return (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: 2,
                p: 3,
              }}
            >
              <Typography variant="h6" color="text.secondary">
                No Community Selected
              </Typography>
              <Typography variant="body2" color="text.secondary" textAlign="center">
                Swipe from the left edge or tap the menu icon to select a community.
              </Typography>
            </Box>
          );
        }
        return null;

      case 'chat':
        if (!communityId || !channelId) {
          return null;
        }
        // On tablet, chat is shown without back button (sidebar is visible)
        return (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <MobileChatPanel
              communityId={communityId}
              channelId={channelId}
            />
          </Box>
        );

      case 'search':
        if (!communityId || !channelId) {
          return null;
        }
        return <MobileSearchScreen communityId={communityId} channelId={channelId} />;

      case 'dm-list':
        return <MobileMessagesPanel />;

      case 'dm-chat':
        if (!dmGroupId) {
          return null;
        }
        return <MobileChatPanel dmGroupId={dmGroupId} />;

      case 'notifications':
        return <NotificationsScreen />;

      case 'profile':
        return <MobileProfilePanel />;

      case 'user-profile':
        return userId ? <MobileProfilePanel userId={userId} /> : null;

      case 'settings':
        // Previously fell through to null, leaving a blank pane on tablets.
        return (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <MobileAppBar title="Settings" showBack />
            <Box sx={{ flex: 1, overflowY: 'auto' }}>
              <SettingsPage />
            </Box>
          </Box>
        );

      case 'route':
        // Non-screen routes render the matched router element via <Outlet/>.
        return (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <MobileAppBar title="Back" showBack />
            <Box sx={{ flex: 1, overflowY: 'auto' }}>
              <Outlet />
            </Box>
          </Box>
        );

      default:
        return null;
    }
  };

  // For non-home tabs, we don't show sidebar so need full-width content with app bar
  const needsOwnAppBar = !showSidebar && currentScreen !== 'chat' && currentScreen !== 'dm-chat';

  return (
    <Box
      sx={{
        flex: 1,
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'background.canvas',
      }}
    >
      {/* App bar for screens without sidebar */}
      {needsOwnAppBar && currentScreen === 'channels' && !communityId && (
        <MobileAppBar title="Home" showDrawerTrigger />
      )}

      {/* Content */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          pb: `${totalBottomOffset}px`,
        }}
      >
        {renderContent()}
      </Box>
    </Box>
  );
};

export default TabletContentArea;
