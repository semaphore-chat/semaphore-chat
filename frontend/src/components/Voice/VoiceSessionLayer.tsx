import React, { Suspense, lazy, useEffect } from "react";
import { TrackSubscriptionProvider } from "./TrackSubscriptionProvider";
import { VoiceEventLogProvider } from "../../hooks/useVoiceEventLog";
import { VoiceTestHooks } from "../../features/voice/VoiceTestHooks";
// Direct imports, not the `./index` barrel: it re-exports components with
// runtime livekit-client imports (see DesktopLayout's note, PR-11).
import { AudioRenderer } from "./AudioRenderer";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";

const VoiceSessionEffects = lazy(() => import("./VoiceSessionEffects"));

/**
 * Mounts the call's behaviour while a call is active: the same condition
 * VoiceBottomBar uses for its content.
 */
const VoiceSessionEffectsGate: React.FC = () => {
  const { state } = useVoiceConnection();
  const isActive = state.isConnected && (!!state.currentChannelId || !!state.currentDmGroupId);

  // Warm the chunk as soon as a join starts, as VoiceBottomBar does.
  useEffect(() => {
    if (state.isConnecting) {
      void import("./VoiceSessionEffects");
    }
  }, [state.isConnecting]);

  if (!isActive) return null;
  return (
    <Suspense fallback={null}>
      <VoiceSessionEffects />
    </Suspense>
  );
};

/**
 * Everything a call needs that is not on screen, mounted once above the
 * layouts (Layout.tsx), so that switching between the phone, tablet and
 * desktop layouts (or, later, between shells) never touches the call:
 *
 * - track subscriptions (the Room has autoSubscribe off, so this is what
 *   makes remote mics play),
 * - the voice event log (the debug panel's history),
 * - the dev/test window hooks,
 * - the hidden <audio> elements,
 * - the call's behaviour (VoiceSessionEffects: push-to-talk, presence
 *   heartbeat, deafen and server-mute enforcement, volumes, wake lock, Media
 *   Session, keep-alive).
 *
 * The visible voice UI (bar, float card, video overlay) stays in each layout
 * and reads the same state (useVoiceConnection, usePushToTalkStatus).
 */
export const VoiceSessionLayer: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <TrackSubscriptionProvider>
    <VoiceEventLogProvider>
      <VoiceTestHooks />
      {children}
      <AudioRenderer />
      <VoiceSessionEffectsGate />
    </VoiceEventLogProvider>
  </TrackSubscriptionProvider>
);

export default VoiceSessionLayer;
