import React from "react";
import CommunityToggle from "../CommunityList/CommunityToggle";
import NotificationCenter from "../Notifications/NotificationCenter";
import { TrackSubscriptionProvider } from "../Voice/TrackSubscriptionProvider";
import { VoiceEventLogProvider } from "../../hooks/useVoiceEventLog";
import { VoiceTestHooks } from "../../features/voice/VoiceTestHooks";
import { VoiceBottomBar, AudioRenderer } from "../Voice";
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
