/* eslint-disable react-refresh/only-export-components */
/**
 * Mobile Navigation Context
 *
 * Screen-based navigation model derived from the URL. The current screen is a
 * pure function of `location.pathname` (see `parseScreenFromPath`), so browser
 * back/forward and deep links stay in sync automatically. Any path that isn't a
 * known "screen" resolves to the `'route'` screen, which renders the matched
 * React Router `<Outlet/>` (edit forms, create pages, admin, etc.).
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { useNavigate, useLocation, matchPath } from 'react-router-dom';
import { useCurrentUser } from '../../../hooks/useCurrentUser';

const LAST_COMMUNITY_KEY = 'semaphore:lastCommunityId';

// Bottom tab options
export type MobileTab = 'home' | 'messages' | 'notifications' | 'profile';

// Screen types - flat hierarchy, max 2 levels deep
export type ScreenType =
  | 'channels'      // Community channel list (home tab default)
  | 'chat'          // Channel chat view
  | 'search'        // Full-screen message search for a channel (/community/:cid/channel/:chid/search)
  | 'dm-list'       // DM conversations list (messages tab default)
  | 'dm-chat'       // DM chat view
  | 'notifications' // Notifications list (notifications tab default)
  | 'profile'       // Own profile (profile tab default)
  | 'user-profile'  // Another user's profile (/profile/:userId, not the current user)
  | 'settings'      // Settings detail view (from profile tab)
  | 'route';        // Fallthrough: render matched router Outlet (edit/create/admin/etc.)

export interface ParsedScreen {
  screen: ScreenType;
  communityId: string | null;
  channelId: string | null;
  dmGroupId: string | null;
  userId: string | null;
}

/**
 * Pure mapping from a pathname to a screen + its route params.
 * Anything not explicitly recognized resolves to the `'route'` screen so the
 * matched React Router element renders via `<Outlet/>`.
 */
export function parseScreenFromPath(pathname: string): ParsedScreen {
  const empty = { communityId: null, channelId: null, dmGroupId: null, userId: null };

  // /community/:communityId/channel/:channelId -> chat
  const chat = matchPath('/community/:communityId/channel/:channelId', pathname);
  if (chat) {
    return {
      screen: 'chat',
      communityId: chat.params.communityId ?? null,
      channelId: chat.params.channelId ?? null,
      dmGroupId: null,
      userId: null,
    };
  }

  // /community/:communityId/channel/:channelId/search -> search
  const search = matchPath('/community/:communityId/channel/:channelId/search', pathname);
  if (search) {
    return {
      screen: 'search',
      communityId: search.params.communityId ?? null,
      channelId: search.params.channelId ?? null,
      dmGroupId: null,
      userId: null,
    };
  }

  // /community/create and /community/:communityId/edit are dedicated pages -> route
  // (checked before the bare community match so "create" isn't treated as an id)
  if (matchPath('/community/create', pathname) || matchPath('/community/:communityId/edit', pathname)) {
    return { screen: 'route', ...empty };
  }

  // /community/:communityId (exactly) -> channels
  const channels = matchPath('/community/:communityId', pathname);
  if (channels) {
    return { ...empty, screen: 'channels', communityId: channels.params.communityId ?? null };
  }

  // /direct-messages/:dmGroupId -> dm-chat
  const dmChat = matchPath('/direct-messages/:dmGroupId', pathname);
  if (dmChat) {
    return { ...empty, screen: 'dm-chat', dmGroupId: dmChat.params.dmGroupId ?? null };
  }

  // /direct-messages -> dm-list
  if (matchPath('/direct-messages', pathname)) {
    return { screen: 'dm-list', ...empty };
  }

  // /notifications -> notifications
  if (matchPath('/notifications', pathname)) {
    return { screen: 'notifications', ...empty };
  }

  // /settings and /settings/* -> settings
  if (matchPath('/settings', pathname) || matchPath('/settings/*', pathname)) {
    return { screen: 'settings', ...empty };
  }

  // /profile/edit is the edit form page -> route (checked before /profile/:userId)
  if (matchPath('/profile/edit', pathname)) {
    return { screen: 'route', ...empty };
  }

  // /profile -> own profile
  if (matchPath('/profile', pathname)) {
    return { screen: 'profile', ...empty };
  }

  // /profile/:userId -> user-profile. This parser is pure and doesn't know who
  // the current user is; the provider folds /profile/<me> back into 'profile'.
  const userProfile = matchPath('/profile/:userId', pathname);
  if (userProfile) {
    return { ...empty, screen: 'user-profile', userId: userProfile.params.userId ?? null };
  }

  // / (home) -> channels with no community selected; the Home tab handler
  // (setActiveTab) is what navigates to lastCommunityId, not this parser
  if (matchPath('/', pathname)) {
    return { screen: 'channels', ...empty };
  }

  // Everything else (admin, friends, debug, unknown) -> render router Outlet
  return { screen: 'route', ...empty };
}

// Navigation state
export interface MobileNavigationState {
  currentScreen: ScreenType;
  communityId: string | null;
  channelId: string | null;
  dmGroupId: string | null;
  /** Set only on the 'user-profile' screen (another user's profile). */
  userId: string | null;
  isDrawerOpen: boolean;
}

// Context type with actions
interface MobileNavigationContextType {
  state: MobileNavigationState;
  activeTab: MobileTab;
  /** The community last opened (persisted); the tablet sidebar keeps showing it on DM/notification screens. */
  lastCommunityId: string | null;

  // Screen navigation
  navigateToChannels: (communityId: string) => void;
  navigateToChat: (communityId: string, channelId: string) => void;
  navigateToSearch: (communityId: string, channelId: string) => void;
  navigateToDmList: () => void;
  navigateToDmChat: (dmGroupId: string) => void;
  navigateToNotifications: () => void;
  navigateToProfile: () => void;
  navigateToSettings: () => void;

  // Generic back navigation
  goBack: () => void;
  canGoBack: () => boolean;

  // Tab switching
  setActiveTab: (tab: MobileTab) => void;

  // Drawer control
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;

  // Legacy compatibility - get current screen info
  getCurrentScreen: () => { type: ScreenType; communityId?: string; channelId?: string; dmGroupId?: string; userId?: string };
}

const MobileNavigationContext = createContext<MobileNavigationContextType | undefined>(
  undefined
);

// Helper to determine active tab from screen (+ pathname for 'route' screens).
// Returns null for 'user-profile': someone else's profile belongs to whichever
// tab the user came from (chat, DMs, notifications), not to the Profile tab.
const getTabFromScreen = (screen: ScreenType, pathname: string): MobileTab | null => {
  switch (screen) {
    case 'channels':
    case 'chat':
    case 'search':
      return 'home';
    case 'dm-list':
    case 'dm-chat':
      return 'messages';
    case 'notifications':
      return 'notifications';
    case 'profile':
    case 'settings':
      return 'profile';
    case 'user-profile':
      return null;
    case 'route':
      if (pathname.startsWith('/community')) return 'home';
      if (pathname.startsWith('/profile') || pathname.startsWith('/settings')) return 'profile';
      if (pathname.startsWith('/direct-messages')) return 'messages';
      return 'home';
  }
};

const isDetailScreen = (screen: ScreenType): boolean =>
  screen === 'chat' || screen === 'search' || screen === 'dm-chat' || screen === 'settings' || screen === 'user-profile';

export const MobileNavigationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Drawer is the only genuinely local UI state; screen is derived from the URL.
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Last community selected — persisted so the Home tab restores after reload.
  const [lastCommunityId, setLastCommunityId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_COMMUNITY_KEY);
    } catch {
      return null;
    }
  });

  const persistLastCommunity = useCallback((id: string) => {
    setLastCommunityId(id);
    try {
      localStorage.setItem(LAST_COMMUNITY_KEY, id);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }, []);

  const { user: currentUser } = useCurrentUser();
  const currentUserId = currentUser?.id ?? null;

  // Derived screen state. /profile/<my id> is the own profile, not 'user-profile'.
  const parsed = useMemo((): ParsedScreen => {
    const p = parseScreenFromPath(location.pathname);
    if (p.screen === 'user-profile' && currentUserId && p.userId === currentUserId) {
      return { ...p, screen: 'profile', userId: null };
    }
    return p;
  }, [location.pathname, currentUserId]);

  // Keep lastCommunityId in sync when we land on a community screen
  useEffect(() => {
    if (parsed.communityId && parsed.communityId !== lastCommunityId) {
      persistLastCommunity(parsed.communityId);
    }
  }, [parsed.communityId, lastCommunityId, persistLastCommunity]);

  const state: MobileNavigationState = useMemo(
    () => ({
      currentScreen: parsed.screen,
      communityId: parsed.communityId,
      channelId: parsed.channelId,
      dmGroupId: parsed.dmGroupId,
      userId: parsed.userId,
      isDrawerOpen,
    }),
    [parsed, isDrawerOpen]
  );

  // Screens without a tab of their own ('user-profile') keep the last real tab
  // highlighted. Adjusting state during render (not in an effect) is the
  // React-recommended way to remember a value from a previous render.
  const screenTab = getTabFromScreen(parsed.screen, location.pathname);
  const [lastTab, setLastTab] = useState<MobileTab>(screenTab ?? 'home');
  if (screenTab && screenTab !== lastTab) {
    setLastTab(screenTab);
  }
  const activeTab: MobileTab = screenTab ?? lastTab;

  // Navigation actions
  const navigateToChannels = useCallback((communityId: string) => {
    persistLastCommunity(communityId);
    navigate(`/community/${communityId}`);
  }, [navigate, persistLastCommunity]);

  const navigateToChat = useCallback((communityId: string, channelId: string) => {
    persistLastCommunity(communityId);
    navigate(`/community/${communityId}/channel/${channelId}`);
  }, [navigate, persistLastCommunity]);

  const navigateToSearch = useCallback((communityId: string, channelId: string) => {
    navigate(`/community/${communityId}/channel/${channelId}/search`);
  }, [navigate]);

  const navigateToDmList = useCallback(() => {
    navigate('/direct-messages');
  }, [navigate]);

  const navigateToDmChat = useCallback((dmGroupId: string) => {
    navigate(`/direct-messages/${dmGroupId}`);
  }, [navigate]);

  const navigateToNotifications = useCallback(() => {
    navigate('/notifications');
  }, [navigate]);

  const navigateToProfile = useCallback(() => {
    navigate('/profile');
  }, [navigate]);

  const navigateToSettings = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  // Back navigation
  const canGoBack = useCallback((): boolean => {
    if (isDetailScreen(parsed.screen) || parsed.screen === 'route') return true;
    return (window.history.state?.idx ?? 0) > 0;
  }, [parsed.screen]);

  const goBack = useCallback(() => {
    // Prefer real browser history when there's somewhere to go back to.
    if ((window.history.state?.idx ?? 0) > 0) {
      navigate(-1);
      return;
    }
    // Fallback hierarchical targets for hard entry points (deep links, PWA launch).
    if (parsed.screen === 'chat' && parsed.communityId) {
      navigate(`/community/${parsed.communityId}`);
    } else if (parsed.screen === 'search' && parsed.communityId && parsed.channelId) {
      navigate(`/community/${parsed.communityId}/channel/${parsed.channelId}`);
    } else if (parsed.screen === 'dm-chat') {
      navigate('/direct-messages');
    } else if (parsed.screen === 'settings') {
      navigate('/profile');
    } else {
      navigate('/');
    }
  }, [parsed.screen, parsed.communityId, parsed.channelId, navigate]);

  // Tab switching
  const setActiveTab = useCallback((tab: MobileTab) => {
    setIsDrawerOpen(false);

    switch (tab) {
      case 'home':
        if (lastCommunityId) {
          navigate(`/community/${lastCommunityId}`);
        } else {
          navigate('/');
        }
        break;
      case 'messages':
        navigate('/direct-messages');
        break;
      case 'notifications':
        navigate('/notifications');
        break;
      case 'profile':
        navigate('/profile');
        break;
    }
  }, [navigate, lastCommunityId]);

  // Drawer control
  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => setIsDrawerOpen((prev) => !prev), []);

  // Legacy compatibility
  const getCurrentScreen = useCallback(() => ({
    type: parsed.screen,
    communityId: parsed.communityId || undefined,
    channelId: parsed.channelId || undefined,
    dmGroupId: parsed.dmGroupId || undefined,
    userId: parsed.userId || undefined,
  }), [parsed]);

  const value: MobileNavigationContextType = {
    state,
    activeTab,
    lastCommunityId,
    navigateToChannels,
    navigateToChat,
    navigateToSearch,
    navigateToDmList,
    navigateToDmChat,
    navigateToNotifications,
    navigateToProfile,
    navigateToSettings,
    goBack,
    canGoBack,
    setActiveTab,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    getCurrentScreen,
  };

  return (
    <MobileNavigationContext.Provider value={value}>
      {children}
    </MobileNavigationContext.Provider>
  );
};

export const useMobileNavigation = () => {
  const context = useContext(MobileNavigationContext);
  if (context === undefined) {
    throw new Error('useMobileNavigation must be used within MobileNavigationProvider');
  }
  return context;
};

// Convenience hook for just checking if drawer is open
export const useMobileDrawer = () => {
  const { state, openDrawer, closeDrawer, toggleDrawer } = useMobileNavigation();
  return {
    isOpen: state.isDrawerOpen,
    open: openDrawer,
    close: closeDrawer,
    toggle: toggleDrawer,
  };
};
