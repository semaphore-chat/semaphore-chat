/**
 * MobileScreenContainer Component
 *
 * Renders the current screen based on navigation state.
 * Replaces the old panel stack with flat screen-based rendering.
 *
 * Screen hierarchy (max 2 levels deep):
 * - channels: Community channel list (home tab default)
 * - chat: Channel chat view
 * - dm-list: DM conversations list (messages tab)
 * - dm-chat: DM chat view
 * - notifications: Notification list
 * - profile: Profile/settings
 */

import React from 'react';
import { Box, Slide, Typography } from '@mui/material';
import { useMobileNavigation, type ScreenType } from '../Navigation/MobileNavigationContext';
import { LAYOUT_CONSTANTS, MOBILE_ANIMATIONS } from '../../../utils/breakpoints';

// Import screen components (reusing existing panels for now)
import { MobileChannelsPanel } from '../Panels/MobileChannelsPanel';
import { MobileChatPanel } from '../Panels/MobileChatPanel';
import { MobileMessagesPanel } from '../Panels/MobileMessagesPanel';
import { MobileProfilePanel } from '../Panels/MobileProfilePanel';
import { NotificationsScreen } from './NotificationsScreen';
import MobileAppBar from '../MobileAppBar';
import SettingsPage from '../../../pages/SettingsPage';

interface MobileScreenContainerProps {
  bottomOffset?: number;
}

// Helper to determine if a screen is a "detail" view (slides in from right)
const isDetailScreen = (screen: ScreenType): boolean => {
  return screen === 'chat' || screen === 'dm-chat' || screen === 'settings';
};


/**
 * Container that renders screens based on current navigation state
 */
export const MobileScreenContainer: React.FC<MobileScreenContainerProps> = ({
  bottomOffset = 0,
}) => {
  const { state } = useMobileNavigation();
  const { currentScreen, communityId, channelId, dmGroupId } = state;

  // Track previous screen for transition direction
  const [prevScreen, setPrevScreen] = React.useState<ScreenType>(currentScreen);
  const [slideIn, setSlideIn] = React.useState(true);

  React.useEffect(() => {
    // Determine transition direction based on screen hierarchy
    const wasDetail = isDetailScreen(prevScreen);
    const isDetail = isDetailScreen(currentScreen);

    if (isDetail && !wasDetail) {
      // Going deeper (list -> detail): slide in from right
      setSlideIn(true);
    } else if (!isDetail && wasDetail) {
      // Going back (detail -> list): slide in from left
      setSlideIn(false);
    }

    setPrevScreen(currentScreen);
  }, [currentScreen, prevScreen]);

  const totalBottomOffset = LAYOUT_CONSTANTS.BOTTOM_NAV_HEIGHT_MOBILE + bottomOffset;

  const renderScreen = () => {
    switch (currentScreen) {
      case 'channels':
        if (!communityId) {
          // No community selected - show empty state with app bar
          return (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <MobileAppBar title="Home" showDrawerTrigger />
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  gap: 2,
                  p: 3,
                }}
              >
                <Typography variant="h6" color="text.secondary">
                  No Community Selected
                </Typography>
                <Typography variant="body2" color="text.secondary" textAlign="center">
                  Tap the menu icon to select a community.
                </Typography>
              </Box>
            </Box>
          );
        }
        return <MobileChannelsPanel communityId={communityId} />;

      case 'chat':
        if (!communityId || !channelId) {
          return null;
        }
        return (
          <MobileChatPanel
            communityId={communityId}
            channelId={channelId}
          />
        );

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

      case 'settings':
        return (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <MobileAppBar title="Settings" showBack />
            <Box sx={{ flex: 1, overflowY: 'auto' }}>
              <SettingsPage />
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
        position: 'relative',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: 'background.default',
      }}
    >
      <Slide
        key={currentScreen}
        direction={slideIn ? 'left' : 'right'}
        in={true}
        timeout={MOBILE_ANIMATIONS.NORMAL}
      >
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            overflow: 'auto',
            pb: `${totalBottomOffset}px`,
            backgroundColor: 'background.default',
          }}
        >
          {renderScreen()}
        </Box>
      </Slide>
    </Box>
  );
};
