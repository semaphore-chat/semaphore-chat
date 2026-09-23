import React, { Suspense, lazy, useEffect } from "react";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";

// The real bottom-bar UI (VoiceBottomBarContent) pulls in every voice-session
// hook — including several that statically import livekit-client for runtime
// enums (Track, RoomEvent, ...). Loading it lazily keeps that whole subtree,
// and the LiveKit chunk it needs, out of the always-mounted app shell for
// users who never join voice. See PR-11 (bundle splitting).
const VoiceBottomBarContent = lazy(() => import("./VoiceBottomBarContent"));

/**
 * Always-mounted shell (see Layout.tsx). Renders nothing until voice is
 * connected, then Suspense-loads the real bar. Kept intentionally thin and
 * free of any livekit-client import so it never contributes to the eager
 * bundle graph.
 */
export const VoiceBottomBar: React.FC = () => {
  const { state } = useVoiceConnection();
  const isActive = state.isConnected && (!!state.currentChannelId || !!state.currentDmGroupId);

  // Warm the content chunk as soon as a join starts (the existing
  // "Connecting…" phase), so it's already cached by the time isConnected
  // flips true and this Suspense boundary would otherwise show a gap after
  // the LiveKit chunk itself has already loaded via the join flow.
  useEffect(() => {
    if (state.isConnecting) {
      void import("./VoiceBottomBarContent");
    }
  }, [state.isConnecting]);

  if (!isActive) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <VoiceBottomBarContent />
    </Suspense>
  );
};
