/**
 * TabletNavHeader Component
 *
 * The tablet's only navigation: Home / Messages / Notifications / Profile at
 * the top of the always-visible sidebar. Replaces the phone's bottom nav on
 * tablet, so the split view keeps the full height for content.
 */

import React from 'react';
import { Badge, Box, ButtonBase, Typography } from '@mui/material';
import {
  Home as HomeIcon,
  Chat as ChatIcon,
  Notifications as NotificationsIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { notificationsControllerGetUnreadCountOptions } from '../../../api-client/@tanstack/react-query.gen';
import { useMobileNavigation, type MobileTab } from '../Navigation/MobileNavigationContext';
import { useReadReceipts } from '../../../hooks/useReadReceipts';
import { LAYOUT_CONSTANTS, TOUCH_TARGETS } from '../../../utils/breakpoints';

interface NavItem {
  tab: MobileTab;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

export const TabletNavHeader: React.FC = () => {
  const { activeTab, setActiveTab } = useMobileNavigation();
  const { data: unreadData } = useQuery({
    ...notificationsControllerGetUnreadCountOptions(),
    refetchOnWindowFocus: true,
  });
  const notificationCount = unreadData?.count ?? 0;
  const { totalDmUnreadCount } = useReadReceipts();

  const items: NavItem[] = [
    { tab: 'home', label: 'Home', icon: <HomeIcon /> },
    { tab: 'messages', label: 'Messages', icon: <ChatIcon />, badge: totalDmUnreadCount },
    { tab: 'notifications', label: 'Notifications', icon: <NotificationsIcon />, badge: notificationCount },
    { tab: 'profile', label: 'Profile', icon: <PersonIcon /> },
  ];

  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={{
        display: 'flex',
        alignItems: 'stretch',
        height: LAYOUT_CONSTANTS.APPBAR_HEIGHT_MOBILE,
        flexShrink: 0,
        px: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        backgroundColor: 'background.paper',
      }}
    >
      {items.map(({ tab, label, icon, badge }) => {
        const selected = activeTab === tab;
        return (
          <ButtonBase
            key={tab}
            onClick={() => setActiveTab(tab)}
            aria-label={label}
            aria-current={selected ? 'page' : undefined}
            focusRipple
            sx={{
              flex: 1,
              minWidth: TOUCH_TARGETS.MINIMUM,
              minHeight: TOUCH_TARGETS.MINIMUM,
              flexDirection: 'column',
              gap: '2px',
              borderRadius: 1,
              color: selected ? 'primary.main' : 'text.secondary',
              '& .MuiSvgIcon-root': { fontSize: '1.375rem' },
              '&:hover': { backgroundColor: 'action.hover' },
              '&.Mui-focusVisible': { backgroundColor: 'action.focus' },
            }}
          >
            <Badge
              badgeContent={badge}
              color="error"
              max={99}
              // Compact badge so it stays inside the 56px header row.
              sx={{
                '& .MuiBadge-badge': {
                  height: 16,
                  minWidth: 16,
                  px: 0.5,
                  fontSize: '0.625rem',
                  top: 3,
                },
              }}
            >
              {icon}
            </Badge>
            <Typography
              component="span"
              noWrap
              sx={{
                fontSize: '0.6875rem',
                fontWeight: selected ? 600 : 500,
                lineHeight: 1.2,
                maxWidth: '100%',
              }}
            >
              {label}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
};

export default TabletNavHeader;
