import React, { useEffect } from "react";
import { Box, AppBar, Toolbar, Typography, IconButton } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import { Outlet, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { authControllerLogoutMutation } from "./api-client/@tanstack/react-query.gen";
import { useCurrentUser } from "./hooks/useCurrentUser";
import ThemeToggle from "./components/ThemeToggle/ThemeToggle";
import CommunityToggle from "./components/CommunityList/CommunityToggle";
import NavigationLinks from "./components/NavBar/NavigationLinks";
import ProfileIcon from "./components/NavBar/ProfileIcon";
import { VoiceBottomBar, AudioRenderer } from "./components/Voice";
import { PersistentVideoOverlay } from "./components/Voice/PersistentVideoOverlay";
import { useVoiceConnection } from "./hooks/useVoiceConnection";
import { useVoiceRecovery } from "./hooks/useVoiceRecovery";
import { MobileLayout } from "./components/Mobile/MobileLayout";
import { TabletLayout } from "./components/Mobile/Tablet/TabletLayout";
import { useResponsive } from "./hooks/useResponsive";
import type { User } from "./types/auth.type";
import { APPBAR_HEIGHT, SIDEBAR_WIDTH, VOICE_BAR_HEIGHT } from "./constants/layout";
import { useNotificationSideEffects } from "./hooks/useNotificationSideEffects";
import { useVoicePresenceSounds } from "./hooks/useVoicePresenceSounds";
import NotificationBadge from "./components/Notifications/NotificationBadge";
import NotificationCenter from "./components/Notifications/NotificationCenter";
import { ReplayBufferProvider } from "./contexts/ReplayBufferContext";
import { VideoOverlayProvider, useVideoOverlay } from "./contexts/VideoOverlayContext";
import { SocketHubProvider } from "./socket-hub";
import { IncomingCallProvider } from "./contexts/IncomingCallContext";
import { IncomingCallListener } from "./components/DirectMessage/IncomingCallListener";
import { IncomingCallBanner } from "./components/DirectMessage/IncomingCallBanner";
import { setTelemetryUser, clearTelemetryUser } from "./services/telemetry";
import { useThemeSync } from "./hooks/useThemeSync";
import { disconnectSocket } from "./utils/socketSingleton";
import { clearSavedConnection } from "./features/voice/voiceActions";
import { clearTokens, getElectronRefreshToken } from "./utils/tokenService";
import { isElectron } from "./utils/platform";

const settings = ["My Profile", "Settings", "Logout"];

/** Content area that registers itself as the fallback video overlay container */
const LayoutContentArea: React.FC<{ voiceConnected: boolean; isMenuExpanded: boolean }> = ({
  voiceConnected,
  isMenuExpanded,
}) => {
  const { setDefaultContainer } = useVideoOverlay();

  return (
    <Box
      ref={setDefaultContainer}
      sx={{
        position: "absolute",
        top: APPBAR_HEIGHT,
        left: isMenuExpanded ? 320 : SIDEBAR_WIDTH,
        right: 0,
        bottom: voiceConnected ? VOICE_BAR_HEIGHT : 0,
        overflow: "auto",
        transition: "left 0.3s cubic-bezier(0.4,0,0.2,1)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ flex: 1, minHeight: "100%" }}>
        <Outlet />
      </Box>
    </Box>
  );
};

/** Inner component that uses hooks requiring SocketHubProvider context */
const LayoutHooksBridge: React.FC = () => {
  // Notification side effects (sounds, desktop notifications, Electron click)
  useNotificationSideEffects({
    showDesktopNotifications: true,
    playSound: true,
  });

  // Voice presence sounds (other users joining/leaving your channel)
  useVoicePresenceSounds();

  return null;
};

const Layout: React.FC = () => {
  const navigate = useNavigate();
  const { user: userData, isLoading, isError } = useCurrentUser();
  const { mutateAsync: logout, isPending: logoutLoading } = useMutation(authControllerLogoutMutation());
  const { state: voiceState, actions: voiceActions } = useVoiceConnection();
  const { isMobile, isTablet } = useResponsive();

  // Sync theme settings with server (server wins on initial load)
  useThemeSync();

  // Attempt to recover voice connection after page refresh
  useVoiceRecovery();

  // Set telemetry user context when profile loads
  useEffect(() => {
    if (userData && !isLoading && !isError) {
      setTelemetryUser({
        id: userData.id,
        username: userData.username,
      });
    }
  }, [userData, isLoading, isError]);

  const [isMenuExpanded, setIsMenuExpanded] = React.useState(false);
  const [anchorElUser, setAnchorElUser] = React.useState<null | HTMLElement>(
    null
  );
  const [notificationCenterOpen, setNotificationCenterOpen] = React.useState(false);

  const handleOpenUserMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElUser(event.currentTarget);
  };

  const handleCloseUserMenu = () => {
    setAnchorElUser(null);
  };

  const handleSettingClick = (setting: string) => {
    if (setting === "My Profile") {
      if (userData?.id) {
        navigate(`/profile/${userData.id}`);
      }
    } else if (setting === "Settings") {
      navigate("/settings");
    } else if (setting === "Logout") {
      handleLogout();
    }
  };

  const handleLogout = async () => {
    // Disconnect voice if connected
    if (voiceState.isConnected) {
      try {
        await voiceActions.leaveVoiceChannel();
      } catch {
        // Best effort — don't block logout
      }
    }
    clearSavedConnection();
    disconnectSocket();
    // Electron clients must send refresh token in body since cookies don't work cross-origin
    const refreshToken = isElectron() ? (await getElectronRefreshToken()) ?? undefined : undefined;
    await logout({ body: { refreshToken } });
    clearTokens();
    clearTelemetryUser();
    navigate("/login");
  };

  // Fix userData type for ProfileIcon
  const profileUserData = userData
    ? {
        displayName: userData.displayName ?? undefined,
        avatarUrl: userData.avatarUrl ?? undefined,
      }
    : undefined;

  // Use mobile layout on phones (< 768px)
  if (isMobile) {
    return (
      <ReplayBufferProvider>
        <SocketHubProvider>
          <IncomingCallProvider>
            <LayoutHooksBridge />
            <IncomingCallListener />
            <IncomingCallBanner />
            <MobileLayout />
          </IncomingCallProvider>
        </SocketHubProvider>
      </ReplayBufferProvider>
    );
  }

  // Use tablet layout on tablets (768-1199px)
  if (isTablet) {
    return (
      <ReplayBufferProvider>
        <SocketHubProvider>
          <IncomingCallProvider>
            <LayoutHooksBridge />
            <IncomingCallListener />
            <IncomingCallBanner />
            <TabletLayout />
          </IncomingCallProvider>
        </SocketHubProvider>
      </ReplayBufferProvider>
    );
  }

  // Desktop layout (original)
  return (
    <ReplayBufferProvider>
      <SocketHubProvider>
        <IncomingCallProvider>
          <LayoutHooksBridge />
          <IncomingCallListener />
          <IncomingCallBanner />
          <VideoOverlayProvider>
            <AppBar position="fixed">
              <Toolbar sx={{ minHeight: APPBAR_HEIGHT }}>
                <div
                  style={{
                    flexGrow: 1,
                    flexDirection: "row",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25em",
                  }}
                >
                  <IconButton
                    size="large"
                    edge="start"
                    aria-label="menu"
                    onClick={() => setIsMenuExpanded(!isMenuExpanded)}
                    sx={{ mr: 2, color: "text.primary" }}
                  >
                    <MenuIcon />
                  </IconButton>
                  <Typography variant="h6" sx={{ color: "text.primary" }}>Kraken</Typography>
                </div>
                <NavigationLinks
                  isLoading={isLoading}
                  isError={isError}
                  userData={userData as User | undefined}
                  handleLogout={handleLogout}
                  logoutLoading={logoutLoading}
                />
                <ThemeToggle />
                &nbsp;
                {!isLoading && (
                  <>
                    <NotificationBadge
                      onClick={() => setNotificationCenterOpen(true)}
                    />
                    <ProfileIcon
                      userData={profileUserData}
                      anchorElUser={anchorElUser}
                      handleOpenUserMenu={handleOpenUserMenu}
                      handleCloseUserMenu={handleCloseUserMenu}
                      settings={settings}
                      onSettingClick={handleSettingClick}
                    />
                  </>
                )}
              </Toolbar>
            </AppBar>
            <NotificationCenter
              open={notificationCenterOpen}
              onClose={() => setNotificationCenterOpen(false)}
            />
            <CommunityToggle
              isExpanded={isMenuExpanded}
              appBarHeight={APPBAR_HEIGHT}
            />
            <LayoutContentArea voiceConnected={voiceState.isConnected} isMenuExpanded={isMenuExpanded} />

            {/* Voice Components */}
            <VoiceBottomBar />
            <AudioRenderer />
            <PersistentVideoOverlay />
          </VideoOverlayProvider>
        </IncomingCallProvider>
      </SocketHubProvider>
    </ReplayBufferProvider>
  );
};

export default Layout;
