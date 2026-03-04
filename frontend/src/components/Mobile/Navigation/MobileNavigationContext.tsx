/* eslint-disable react-refresh/only-export-components */
/**
 * Mobile Navigation Context
 *
 * Screen-based navigation model (replaces panel stack).
 * Integrates with React Router for proper PWA back button support.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Bottom tab options
export type MobileTab = 'home' | 'messages' | 'notifications' | 'profile';

// Screen types - flat hierarchy, max 2 levels deep
export type ScreenType =
  | 'channels'      // Community channel list (home tab default)
  | 'chat'          // Channel chat view
  | 'dm-list'       // DM conversations list (messages tab default)
  | 'dm-chat'       // DM chat view
  | 'notifications' // Notifications list (notifications tab default)
  | 'profile'       // Profile (profile tab default)
  | 'settings';     // Settings detail view (from profile tab)

// Navigation state
export interface MobileNavigationState {
  // Current screen
  currentScreen: ScreenType;

  // Community context (for channels/chat screens)
  communityId: string | null;
  channelId: string | null;

  // DM context (for dm-chat screen)
  dmGroupId: string | null;

  // UI state
  isDrawerOpen: boolean;
}

// Context type with actions
interface MobileNavigationContextType {
  // Current state
  state: MobileNavigationState;
  activeTab: MobileTab;

  // Screen navigation
  navigateToChannels: (communityId: string) => void;
  navigateToChat: (communityId: string, channelId: string) => void;
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
  getCurrentScreen: () => { type: ScreenType; communityId?: string; channelId?: string; dmGroupId?: string };
}

const MobileNavigationContext = createContext<MobileNavigationContextType | undefined>(
  undefined
);

// Helper to determine active tab from screen
const getTabFromScreen = (screen: ScreenType): MobileTab => {
  switch (screen) {
    case 'channels':
    case 'chat':
      return 'home';
    case 'dm-list':
    case 'dm-chat':
      return 'messages';
    case 'notifications':
      return 'notifications';
    case 'profile':
    case 'settings':
      return 'profile';
  }
};

export const MobileNavigationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Navigation state
  const [state, setState] = useState<MobileNavigationState>({
    currentScreen: 'channels',
    communityId: null,
    channelId: null,
    dmGroupId: null,
    isDrawerOpen: false,
  });

  // Track last community for returning from other tabs
  const [lastCommunityId, setLastCommunityId] = useState<string | null>(null);

  // Sync state from URL on location change
  useEffect(() => {
    const path = location.pathname;

    // Parse URL to determine current screen
    if (path.startsWith('/community/')) {
      const segments = path.split('/');
      const communityId = segments[2];
      const channelId = segments[4]; // /community/:id/channel/:channelId

      if (channelId) {
        setState(prev => ({
          ...prev,
          currentScreen: 'chat',
          communityId,
          channelId,
          dmGroupId: null,
        }));
      } else if (communityId) {
        setState(prev => ({
          ...prev,
          currentScreen: 'channels',
          communityId,
          channelId: null,
          dmGroupId: null,
        }));
        setLastCommunityId(communityId);
      }
    } else if (path.startsWith('/direct-messages')) {
      const segments = path.split('/');
      const dmGroupId = segments[2]; // /direct-messages/:dmGroupId

      if (dmGroupId) {
        setState(prev => ({
          ...prev,
          currentScreen: 'dm-chat',
          dmGroupId,
          communityId: null,
          channelId: null,
        }));
      } else {
        setState(prev => ({
          ...prev,
          currentScreen: 'dm-list',
          dmGroupId: null,
          communityId: null,
          channelId: null,
        }));
      }
    } else if (path === '/notifications') {
      setState(prev => ({
        ...prev,
        currentScreen: 'notifications',
        communityId: null,
        channelId: null,
        dmGroupId: null,
      }));
    } else if (path === '/settings' || path.startsWith('/settings/')) {
      setState(prev => ({
        ...prev,
        currentScreen: 'settings',
        communityId: null,
        channelId: null,
        dmGroupId: null,
      }));
    } else if (path === '/profile' || path.startsWith('/profile/')) {
      setState(prev => ({
        ...prev,
        currentScreen: 'profile',
        communityId: null,
        channelId: null,
        dmGroupId: null,
      }));
    } else if (path === '/' || path === '') {
      // Home - show channels for last community or first community
      setState(prev => ({
        ...prev,
        currentScreen: 'channels',
        channelId: null,
        dmGroupId: null,
      }));
    }
  }, [location.pathname]);

  // Derived active tab
  const activeTab = getTabFromScreen(state.currentScreen);

  // Navigation actions
  const navigateToChannels = useCallback((communityId: string) => {
    setLastCommunityId(communityId);
    navigate(`/community/${communityId}`);
  }, [navigate]);

  const navigateToChat = useCallback((communityId: string, channelId: string) => {
    setLastCommunityId(communityId);
    navigate(`/community/${communityId}/channel/${channelId}`);
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
    // Can go back if we're in a detail view
    return state.currentScreen === 'chat' || state.currentScreen === 'dm-chat' || state.currentScreen === 'settings';
  }, [state.currentScreen]);

  const goBack = useCallback(() => {
    if (state.currentScreen === 'chat' && state.communityId) {
      // Go back from chat to channels
      navigate(`/community/${state.communityId}`);
    } else if (state.currentScreen === 'dm-chat') {
      // Go back from DM chat to DM list
      navigate('/direct-messages');
    } else if (state.currentScreen === 'settings') {
      // Go back from settings to profile
      navigate('/profile');
    } else {
      // Use browser history for other cases
      navigate(-1);
    }
  }, [state.currentScreen, state.communityId, navigate]);

  // Tab switching
  const setActiveTab = useCallback((tab: MobileTab) => {
    // Close drawer when switching tabs
    setState(prev => ({ ...prev, isDrawerOpen: false }));

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
  const openDrawer = useCallback(() => {
    setState(prev => ({ ...prev, isDrawerOpen: true }));
  }, []);

  const closeDrawer = useCallback(() => {
    setState(prev => ({ ...prev, isDrawerOpen: false }));
  }, []);

  const toggleDrawer = useCallback(() => {
    setState(prev => ({ ...prev, isDrawerOpen: !prev.isDrawerOpen }));
  }, []);

  // Legacy compatibility
  const getCurrentScreen = useCallback(() => ({
    type: state.currentScreen,
    communityId: state.communityId || undefined,
    channelId: state.channelId || undefined,
    dmGroupId: state.dmGroupId || undefined,
  }), [state]);

  const value: MobileNavigationContextType = {
    state,
    activeTab,
    navigateToChannels,
    navigateToChat,
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
