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
import { APPBAR_HEIGHT } from "../../constants/layout";
import type { User } from "../../types/auth.type";
import { DesktopAppBar } from "./DesktopAppBar";
import { DesktopContentArea } from "./DesktopContentArea";

interface DesktopLayoutProps {
  instanceName: string;
  isLoading: boolean;
  isError: boolean;
  userData: User | undefined;
}

/** Desktop layout (original): full AppBar + sidebar + voice bottom bar. */
export const DesktopLayout: React.FC<DesktopLayoutProps> = ({
  instanceName,
  isLoading,
  isError,
  userData,
}) => {
  const { state: voiceState } = useVoiceConnection();
  const [isMenuExpanded, setIsMenuExpanded] = React.useState(false);
  const [notificationCenterOpen, setNotificationCenterOpen] = React.useState(false);

  return (
    <>
      <DesktopAppBar
        instanceName={instanceName}
        isLoading={isLoading}
        isError={isError}
        userData={userData}
        onToggleMenu={() => setIsMenuExpanded((expanded) => !expanded)}
        onNotificationCenterOpen={() => setNotificationCenterOpen(true)}
      />
      <NotificationCenter
        open={notificationCenterOpen}
        onClose={() => setNotificationCenterOpen(false)}
      />
      <CommunityToggle
        isExpanded={isMenuExpanded}
        appBarHeight={APPBAR_HEIGHT}
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
