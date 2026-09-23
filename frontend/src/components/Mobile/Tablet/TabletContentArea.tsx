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

  // The bottom nav and voice bar are in normal flow below the content row
  // (TabletLayout), so only an explicit extra offset needs padding here.
  const totalBottomOffset = bottomOffset;

  const renderContent = () => {
    switch (currentScreen) {
      case 'channels':
        // On tablet with sidebar, show welcome message if no channel selected
        if (showSidebar && communityId && !channelId) {
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
        // No community yet: the sidebar offers "Choose a community".
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
                Choose a community from the sidebar to see its channels.
              </Typography>
            </Box>
          );
        }
        return null;

      case 'chat':
        if (!communityId || !channelId) {
          return null;
        }
        // The sidebar (channel list + nav) is visible, so no back button.
        return (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <MobileChatPanel
              communityId={communityId}
              channelId={channelId}
              hideBack={showSidebar}
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
        // Messages in the sidebar nav returns to the DM list, so no back button.
        return <MobileChatPanel dmGroupId={dmGroupId} hideBack={showSidebar} />;

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
