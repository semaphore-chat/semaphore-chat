import React, { Suspense, lazy, useEffect } from "react";
import { Box } from "@mui/material";
import { useVoiceConnection } from "../../hooks/useVoiceConnection";
import { BOTTOM_CHROME_ORDER, useMeasuredChromeItem } from "../../contexts/BottomChromeContext";
import { LAYOUT_CONSTANTS } from "../../utils/breakpoints";
import { VOICE_BAR_HEIGHT } from "../../constants/layout";

// The real bottom-bar UI (VoiceBottomBarContent) pulls in every voice-session
// hook — including several that statically import livekit-client for runtime
// enums (Track, RoomEvent, ...). Loading it lazily keeps that whole subtree,
// and the LiveKit chunk it needs, out of the always-mounted app shell for
// users who never join voice. See PR-11 (bundle splitting).
const VoiceBottomBarContent = lazy(() => import("./VoiceBottomBarContent"));

interface VoiceBottomBarProps {
  /**
   * Touch layouts (phone/tablet): sit in normal flow at the bottom of the
   * layout column, directly above the bottom nav, instead of `position:
   * fixed` over it. Desktop (and Electron at any width) leaves this off and
   * keeps the fixed bar that `DesktopContentArea` reserves room for.
   */
  inline?: boolean;
}

/**
 * Always-mounted shell (see Layout.tsx). Renders nothing until voice is
 * connected, then Suspense-loads the real bar. Kept intentionally thin and
 * free of any livekit-client import so it never contributes to the eager
 * bundle graph.
 *
 * The shell owns positioning (the content only holds the controls) and
 * registers the bar's measured height with BottomChromeContext, so toasts,
 * the reconnecting chip and FABs stack above it.
 */
export const VoiceBottomBar: React.FC<VoiceBottomBarProps> = ({ inline = false }) => {
  const { state } = useVoiceConnection();
  const isActive = state.isConnected && (!!state.currentChannelId || !!state.currentDmGroupId);
  const measureRef = useMeasuredChromeItem({
    id: "voice-bar",
    order: BOTTOM_CHROME_ORDER.VOICE_BAR,
    fallbackHeight: inline ? LAYOUT_CONSTANTS.VOICE_BAR_HEIGHT_MOBILE : VOICE_BAR_HEIGHT,
    enabled: isActive,
  });

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
    <Box
      ref={measureRef}
      data-testid="voice-bottom-bar"
      sx={
        inline
          ? // Above the floating video surfaces (FloatCard / phone video
            // overlay, zIndex 1200) and persistent drawers, below modals
            // and sheets (1300), which portal on top anyway.
            { position: "relative", flexShrink: 0, zIndex: 1250 }
          : { position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1300 }
      }
    >
      <Suspense fallback={null}>
        <VoiceBottomBarContent />
      </Suspense>
    </Box>
  );
};
