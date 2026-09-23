import React from "react";
import { useQuery } from "@tanstack/react-query";
import { instanceControllerGetPublicSettingsOptions } from "./api-client/@tanstack/react-query.gen";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { useVoiceConnection } from "./hooks/useVoiceConnection";
import { useVoiceRecovery } from "./hooks/useVoiceRecovery";
import { useVoiceForegroundResync } from "./hooks/useVoiceForegroundResync";
import { MobileLayout } from "./components/Mobile/MobileLayout";
import { TabletLayout } from "./components/Mobile/Tablet/TabletLayout";
import { DesktopLayout } from "./components/Desktop/DesktopLayout";
import { useResponsive } from "./hooks/useResponsive";
import type { User } from "./types/auth.type";
import { useThemeSync } from "./hooks/useThemeSync";
import { useAppBadge } from "./hooks/useAppBadge";
import { usePushResync } from "./hooks/usePushResync";
import { LayoutProviders } from "./components/LayoutProviders";

const Layout: React.FC = () => {
  const { user: userData, isLoading, isError } = useCurrentUser();
  const { data: publicSettings } = useQuery(instanceControllerGetPublicSettingsOptions());
  const instanceName = publicSettings?.name || "Semaphore Chat";
  const { isMobile, isTablet } = useResponsive();
  const { state: voiceState, actions: voiceActions } = useVoiceConnection();

  // Sync theme settings with server (server wins on initial load)
  useThemeSync();

  // Attempt to recover voice connection after page refresh
  // TODO: known double-call on mobile (also invoked in MobileLayout)
  useVoiceRecovery();

  // Recover calls that silently died while backgrounded/locked (#350).
  //
  // Mounted here (always-mounted Layout) rather than inside VoiceBottomBarContent
  // (lazy, only mounted once `state.isConnected`) so its `room.on(Disconnected, ...)`
  // listener attaches as soon as `voiceState.room` exists — i.e. right after
  // connectToLiveKitRoom()'s `setRoom(room)` call, which happens BEFORE mic setup
  // and BEFORE `isConnected` flips true (see voiceActions.ts). That gap can be a
  // few seconds (mic-enable has a 5s timeout in VAD mode); a disconnect during it
  // would previously go undetected until the *next* foreground transition.
  // `useVoiceForegroundResync` only holds `import type` livekit-client references
  // (see hooks/useVoiceForegroundResync.ts and features/voice/livekitEvents.ts),
  // so mounting it here doesn't reintroduce an eager livekit-client value import.
  useVoiceForegroundResync({
    room: voiceState.room,
    state: voiceState,
    actions: {
      joinVoiceChannel: voiceActions.joinVoiceChannel,
      joinDmVoice: voiceActions.joinDmVoice,
    },
  });

  // Document title (with "(N)" unread prefix) + PWA icon badge
  useAppBadge(instanceName);

  // Re-sync a rotated push subscription to the backend on startup (the SW
  // can't authenticate; this is the reliable path).
  usePushResync();

  return (
    <LayoutProviders>
      {isMobile ? (
        <MobileLayout />
      ) : isTablet ? (
        <TabletLayout />
      ) : (
        <DesktopLayout
          instanceName={instanceName}
          isLoading={isLoading}
          isError={isError}
          userData={userData as User | undefined}
        />
      )}
    </LayoutProviders>
  );
};

export default Layout;
