/**
 * MobileScreenContainer Component
 *
 * Renders the current screen based on navigation state.
 * Replaces the old panel stack with flat screen-based rendering.
 *
 * Screen hierarchy (max 2 levels deep):
 * - channels: Community channel list (home tab default)
 * - chat: Channel chat view
 * - search: Full-screen message search for a channel
 * - dm-list: DM conversations list (messages tab)
 * - dm-chat: DM chat view
 * - notifications: Notification list
 * - profile: Own profile/settings
 * - user-profile: Another user's profile (/profile/:userId)
 *
 * Keep-alive: each tab's root screen (channel list, DM list, notifications,
 * own profile) stays mounted but hidden while another screen is showing, so
 * switching tabs or opening a chat and coming back keeps the list's scroll
 * position and loaded state. Hidden layers are `visibility: hidden` (layout,
 * and therefore every nested scroll position, is kept), `aria-hidden` and
 * `inert`. Detail screens (chats, search, settings, routes) still unmount when
 * left: a hidden chat would keep marking messages read.
 */

import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Box, Slide, Typography } from '@mui/material';
import {
  useMobileNavigation,
  type MobileNavigationState,
  type MobileTab,
  type ScreenType,
} from '../Navigation/MobileNavigationContext';
import { MOBILE_ANIMATIONS } from '../../../utils/breakpoints';

// Import screen components (reusing existing panels for now)
import { MobileChannelsPanel } from '../Panels/MobileChannelsPanel';
import { MobileChatPanel } from '../Panels/MobileChatPanel';
import { MobileMessagesPanel } from '../Panels/MobileMessagesPanel';
import { MobileProfilePanel } from '../Panels/MobileProfilePanel';
import { NotificationsScreen } from './NotificationsScreen';
import { MobileSearchScreen } from './MobileSearchScreen';
import MobileAppBar from '../MobileAppBar';
import SettingsPage from '../../../pages/SettingsPage';

interface MobileScreenContainerProps {
  bottomOffset?: number;
}

// Helper to determine if a screen is a "detail" view (slides in from right)
const isDetailScreen = (screen: ScreenType): boolean => {
  return (
    screen === 'chat' ||
    screen === 'search' ||
    screen === 'dm-chat' ||
    screen === 'settings' ||
    screen === 'user-profile' ||
    screen === 'route'
  );
};

// Generic title for routed ('route' screen) pages, derived from the path.
const getRouteTitle = (pathname: string): string => {
  if (pathname === '/community/create') return 'Create Community';
  if (/^\/community\/[^/]+\/edit$/.test(pathname)) return 'Edit Community';
  if (pathname === '/profile/edit') return 'Edit Profile';
  if (pathname.startsWith('/admin')) return 'Admin';
  if (pathname.startsWith('/friends')) return 'Friends';
  return 'Back';
};

// Tab root screens are kept mounted (hidden) when left; see the header.
const ROOT_SCREEN_TAB: Partial<Record<ScreenType, MobileTab>> = {
  channels: 'home',
  'dm-list': 'messages',
  notifications: 'notifications',
  profile: 'profile',
};
const TAB_ORDER: MobileTab[] = ['home', 'messages', 'notifications', 'profile'];

interface ScreenDescriptor {
  /** Identity of the rendered screen; a new key remounts it. */
  key: string;
  screen: ScreenType;
  communityId: string | null;
  channelId: string | null;
  dmGroupId: string | null;
  userId: string | null;
  pathname: string;
}

const describeScreen = (state: MobileNavigationState, pathname: string): ScreenDescriptor => {
  const { currentScreen: screen, communityId, channelId, dmGroupId, userId } = state;
  let key: string;
  switch (screen) {
    case 'channels':
      key = `channels:${communityId ?? ''}`;
      break;
    case 'route':
    case 'user-profile':
      key = `${screen}:${pathname}`;
      break;
    default:
      // chat / search / dm-chat: a new conversation mounts a fresh screen
      key = `${screen}:${channelId ?? dmGroupId ?? ''}`;
  }
  return { key, screen, communityId, channelId, dmGroupId, userId, pathname };
};


/**
 * Container that renders screens based on current navigation state
 */
export const MobileScreenContainer: React.FC<MobileScreenContainerProps> = ({
  bottomOffset = 0,
}) => {
  const { state } = useMobileNavigation();
  const location = useLocation();
  const { currentScreen } = state;
  const active = describeScreen(state, location.pathname);

  // Transition direction, decided in the same render as the screen change so
  // the entering screen slides from the correct side on its first frame.
  const [prevScreen, setPrevScreen] = React.useState<ScreenType>(currentScreen);
  const [slideIn, setSlideIn] = React.useState(true);
  if (prevScreen !== currentScreen) {
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
  }

  // The last root screen of each tab, kept mounted while hidden.
  const [keptRoots, setKeptRoots] = React.useState<Partial<Record<MobileTab, ScreenDescriptor>>>(
    {},
  );
  const activeRootTab = ROOT_SCREEN_TAB[active.screen];
  if (activeRootTab && keptRoots[activeRootTab]?.key !== active.key) {
    setKeptRoots((prev) => ({ ...prev, [activeRootTab]: active }));
  }

  const layers: ScreenDescriptor[] = TAB_ORDER.flatMap((tab) => {
    if (tab === activeRootTab) return [active];
    const kept = keptRoots[tab];
    return kept ? [kept] : [];
  });
  if (!activeRootTab) layers.push(active);

  // The bottom nav and voice bar sit in normal flow below this container
  // (MobileLayout, see BottomChromeContext), so nothing covers the screen and
  // only an explicit extra offset needs padding.
  const totalBottomOffset = bottomOffset;

  const renderScreen = ({ screen, communityId, channelId, dmGroupId, userId, pathname }: ScreenDescriptor) => {
    switch (screen) {
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
        return (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <MobileAppBar title="Settings" showBack />
            <Box sx={{ flex: 1, overflowY: 'auto' }}>
              <SettingsPage />
            </Box>
          </Box>
        );

      case 'route':
        // Any non-screen route (edit forms, create pages, admin, friends, etc.)
        // renders the matched React Router element via <Outlet/>.
        return (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <MobileAppBar title={getRouteTitle(pathname)} showBack />
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
        position: 'relative',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: 'background.canvas',
      }}
    >
      {layers.map((layer) => {
        const isActive = layer.key === active.key;
        return (
          <Slide
            key={layer.key}
            direction={slideIn ? 'left' : 'right'}
            in={isActive}
            appear
            // Leaving screens hide at once (the entering one slides over them).
            timeout={{ enter: MOBILE_ANIMATIONS.NORMAL, exit: 0 }}
          >
            <Box
              data-screen-key={layer.key}
              aria-hidden={isActive ? undefined : true}
              inert={!isActive}
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                overflow: 'auto',
                pb: `${totalBottomOffset}px`,
                backgroundColor: 'background.canvas',
                // Slide also hides exited layers; this covers the exit frame.
                ...(isActive ? {} : { visibility: 'hidden', pointerEvents: 'none' }),
              }}
            >
              {renderScreen(layer)}
            </Box>
          </Slide>
        );
      })}
    </Box>
  );
};
