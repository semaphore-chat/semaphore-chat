import React from "react";
import CommunityToggle from "../CommunityList/CommunityToggle";
import NotificationCenter from "../Notifications/NotificationCenter";
import { TrackSubscriptionProvider } from "../Voice/TrackSubscriptionProvider";
import { VoiceEventLogProvider } from "../../hooks/useVoiceEventLog";
import { VoiceTestHooks } from "../../features/voice/VoiceTestHooks";
// Import directly from source files, NOT the `../Voice` barrel
// (components/Voice/index.ts) — that barrel also re-exports VideoTiles,
// VoiceChannelUserList, DeviceSettingsDialog, ScreenSourcePicker, some of
// which hold runtime livekit-client imports and are intentionally
// React.lazy'd elsewhere. A direct import from this always-mounted module
// avoids relying on Rollup tree-shaking the unused re-exports. See PR-11.
import { VoiceBottomBar } from "../Voice/VoiceBottomBar";
import { AudioRenderer } from "../Voice/AudioRenderer";
import { PersistentVideoOverlay } from "../Voice/PersistentVideoOverlay";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import type { User } from "../../types/auth.type";
import { DesktopContentArea } from "./DesktopContentArea";

interface DesktopLayoutProps {
  userData: User | undefined;
}

/**
 * Desktop layout: the community rail (navigation, notification inbox, account
 * menu) + the routed page + the voice bottom bar. No top app bar; Electron
 * keeps its native window frame, so the window still drags by its title bar.
 */
export const DesktopLayout: React.FC<DesktopLayoutProps> = ({ userData }) => {
  const { state: voiceState } = useVoiceConnection();
  const [isMenuExpanded, setIsMenuExpanded] = React.useState(false);
  const [notificationCenterOpen, setNotificationCenterOpen] = React.useState(false);

  return (
    <>
      <NotificationCenter
        open={notificationCenterOpen}
        onClose={() => setNotificationCenterOpen(false)}
      />
      <CommunityToggle
        isExpanded={isMenuExpanded}
        onToggleExpanded={() => setIsMenuExpanded((expanded) => !expanded)}
        onOpenNotifications={() => setNotificationCenterOpen(true)}
        voiceConnected={voiceState.isConnected}
        user={userData}
      />
      <TrackSubscriptionProvider>
        <VoiceEventLogProvider>
          <VoiceTestHooks />
          <DesktopContentArea voiceConnected={voiceState.isConnected} isMenuExpanded={isMenuExpanded} />

          {/* Voice Components */}
          <VoiceBottomBar />
          <AudioRenderer />
          <PersistentVideoOverlay />
        </VoiceEventLogProvider>
      </TrackSubscriptionProvider>
    </>
  );
};

export default DesktopLayout;
