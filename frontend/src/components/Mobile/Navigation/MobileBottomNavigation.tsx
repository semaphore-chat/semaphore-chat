/**
 * MobileBottomNavigation Component
 *
 * Bottom navigation with 4 tabs.
 * Integrates with screen-based navigation for clean tab switching.
 */

import React from 'react';
import { BottomNavigation, BottomNavigationAction, Paper, Badge } from '@mui/material';
import {
  Home as HomeIcon,
  Chat as ChatIcon,
  Notifications as NotificationsIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { notificationsControllerGetUnreadCountOptions } from '../../../api-client/@tanstack/react-query.gen';
import { useMobileNavigation, type MobileTab } from './MobileNavigationContext';
import { useBottomNavHidden } from './useBottomNavHidden';
import { useReadReceipts } from '../../../hooks/useReadReceipts';
import { LAYOUT_CONSTANTS, TOUCH_TARGETS } from '../../../utils/breakpoints';
import { BOTTOM_CHROME_ORDER, SAFE_AREA_BOTTOM, useChromeItem } from '../../../contexts/BottomChromeContext';

interface MobileBottomNavigationProps {
  /** Phone layout: hide on chat, DM chat and search screens. */
  hideOnDetailScreens?: boolean;
}

/**
 * Bottom navigation bar with 4 tabs:
 * - Home: Communities and channels
 * - Messages: Direct messages
 * - Notifications: Mentions and activity
 * - Profile: User settings
 */
export const MobileBottomNavigation: React.FC<MobileBottomNavigationProps> = ({
  hideOnDetailScreens = false,
}) => {
  const { activeTab, setActiveTab } = useMobileNavigation();
  const hidden = useBottomNavHidden(hideOnDetailScreens);
  // Registers the bar height (the safe-area padding below it is added by
  // the context) so floating chrome — toasts, the FAB — sits above it.
  useChromeItem({
    id: 'bottom-nav',
    order: BOTTOM_CHROME_ORDER.NAV,
    height: LAYOUT_CONSTANTS.BOTTOM_NAV_HEIGHT_MOBILE,
    enabled: !hidden,
  });
  const { data: unreadData } = useQuery({
    ...notificationsControllerGetUnreadCountOptions(),
    refetchOnWindowFocus: true,
  });
  const notificationCount = unreadData?.count ?? 0;
  const { totalDmUnreadCount } = useReadReceipts();

  const handleChange = (_event: React.SyntheticEvent, newValue: MobileTab) => {
    setActiveTab(newValue);
  };

  if (hidden) return null;

  return (
    <Paper
      elevation={8}
      sx={{
        // Normal flow at the bottom of the layout column — it can never
        // cover content, and content never needs padding for it.
        position: 'relative',
        flexShrink: 0,
        borderRadius: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        // Safe area padding for devices with home indicator
        paddingBottom: SAFE_AREA_BOTTOM,
      }}
    >
      <BottomNavigation
        value={activeTab}
        onChange={handleChange}
        showLabels
        sx={{
          height: LAYOUT_CONSTANTS.BOTTOM_NAV_HEIGHT_MOBILE,
          '& .MuiBottomNavigationAction-root': {
            minWidth: 'auto',
            minHeight: TOUCH_TARGETS.MINIMUM,
            padding: '6px 12px 8px',
            gap: '4px',
          },
          '& .MuiBottomNavigationAction-label': {
            fontSize: '0.6875rem',
            fontWeight: 500,
            marginTop: '2px',
            '&.Mui-selected': {
              fontSize: '0.6875rem',
              fontWeight: 600,
            },
          },
          '& .MuiSvgIcon-root': {
            fontSize: '1.375rem',
          },
        }}
      >
        <BottomNavigationAction
          label="Home"
          value="home"
          icon={<HomeIcon />}
        />
        <BottomNavigationAction
          label="Messages"
          value="messages"
          icon={
            <Badge badgeContent={totalDmUnreadCount} color="error" max={99}>
              <ChatIcon />
            </Badge>
          }
        />
        <BottomNavigationAction
          label="Notifications"
          value="notifications"
          icon={
            <Badge badgeContent={notificationCount} color="error">
              <NotificationsIcon />
            </Badge>
          }
        />
        <BottomNavigationAction
          label="Profile"
          value="profile"
          icon={<PersonIcon />}
        />
      </BottomNavigation>
    </Paper>
  );
};
