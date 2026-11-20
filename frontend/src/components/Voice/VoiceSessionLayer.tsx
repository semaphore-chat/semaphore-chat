import React, { Suspense, lazy, useEffect, useState } from "react";
import { TrackSubscriptionProvider } from "./TrackSubscriptionProvider";
import { VoiceEventLogProvider } from "../../hooks/useVoiceEventLog";
import { VoiceTestHooks } from "../../features/voice/VoiceTestHooks";
// Direct imports, not the `./index` barrel: it re-exports components with
// runtime livekit-client imports (see DesktopLayout's note, PR-11).
import { AudioRenderer } from "./AudioRenderer";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { logger } from "../../utils/logger";
import { voiceSessionEffectsChunk } from "./voiceSessionEffectsChunk";


/** How many times a failed effects chunk is loaded again before giving up. */
const EFFECTS_RETRIES = 1;

/** A fresh lazy component: React.lazy remembers a rejection, so a retry needs a new one. */
const lazyEffects = () => lazy(() => voiceSessionEffectsChunk.load());

/**
 * Catches a failure to load (or render) the effects, so it never reaches the
 * app-level boundary: that one unmounts AuthGate, and RoomProvider's cleanup
 * would end the call.
 */
class VoiceSessionEffectsBoundary extends React.Component<
  { onError: (error: unknown) => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Mounts the call's behaviour (VoiceSessionEffects): deafen and volume from
 * the moment a Room exists, the rest while a call is active (the condition
 * VoiceBottomBar uses for its content).
 */
const VoiceSessionEffectsGate: React.FC = () => {
  const { state } = useVoiceConnection();
  const isActive = state.isConnected && (!!state.currentChannelId || !!state.currentDmGroupId);
  const hasRoom = !!state.room;
  const wanted = isActive || hasRoom;

  // A failed load gets EFFECTS_RETRIES fresh attempts, then the call carries
  // on without its effects rather than dropping. Back to a fresh start once
  // the call is over.
  const [attempt, setAttempt] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  const [Effects, setEffects] = useState(lazyEffects);
  useEffect(() => {
    if (!wanted && attempt > 0) {
      setAttempt(0);
      setGaveUp(false);
      setEffects(lazyEffects);
    }
  }, [wanted, attempt]);
  const handleError = (error: unknown) => {
    if (attempt < EFFECTS_RETRIES) {
      logger.warn("[VoiceSession] Call effects failed to load, trying again:", error);
      setAttempt((n) => n + 1);
      setEffects(lazyEffects);
    } else {
      logger.error(
        "[VoiceSession] Call effects failed to load again; the call continues without them (no push-to-talk, presence heartbeat, deafen or server-mute enforcement until the next call):",
        error,
      );
      setGaveUp(true);
    }
  };

  // Warm the chunk as soon as a join starts, as VoiceBottomBar does.
  useEffect(() => {
    if (state.isConnecting) {
      void voiceSessionEffectsChunk.load().catch(() => {});
    }
  }, [state.isConnecting]);

  if (!wanted || gaveUp) return null;
  return (
    <VoiceSessionEffectsBoundary key={attempt} onError={handleError}>
      <Suspense fallback={null}>
        <Effects active={isActive} />
      </Suspense>
    </VoiceSessionEffectsBoundary>
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
 *   Session, keep-alive), behind its own error boundary.
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
