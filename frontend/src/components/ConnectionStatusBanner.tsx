import React from "react";
import { Chip, CircularProgress, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useSocketConnected } from "../hooks/useSocket";
import { useResponsive } from "../hooks/useResponsive";
import { BOTTOM_CHROME_ORDER, useBottomChromeOffset } from "../contexts/BottomChromeContext";

/**
 * "Reconnecting…" chip. Top of the bottom stack (BottomChromeContext): it
 * sits above the nav, voice bar, composer and any toast, whichever of them
 * are showing.
 *
 * On the tablet and desktop layouts the chip's left corner is over the
 * sidebar, not the chat column, so it skips the composer level — otherwise
 * it floats a composer's height up over the sidebar's rows. From `md` up the
 * (centred) toast can't reach the left edge either, so it skips that level
 * too. The phone layout (any width) has a full-width composer, so nothing is
 * skipped there. It always clears
 * the full-width nav and voice bar.
 */
export const ConnectionStatusBanner: React.FC = () => {
  const isConnected = useSocketConnected();
  const theme = useTheme();
  const { isMobile } = useResponsive();
  const isMdUp = useMediaQuery(theme.breakpoints.up("md"));
  const offset = useBottomChromeOffset(BOTTOM_CHROME_ORDER.CHIP, {
    skipOrders: isMobile
      ? undefined
      : isMdUp
        ? [BOTTOM_CHROME_ORDER.COMPOSER, BOTTOM_CHROME_ORDER.TOAST]
        : [BOTTOM_CHROME_ORDER.COMPOSER],
  });

  if (isConnected) return null;

  return (
    <Chip
      icon={<CircularProgress size={14} color="inherit" />}
      label="Reconnecting..."
      size="small"
      data-chrome-offset={offset.px}
      sx={{
        position: "fixed",
        bottom: `calc(${offset.css} + 16px)`,
        left: 16,
        zIndex: 9999,
        animation: "connectionPulse 2s ease-in-out infinite",
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "warning.main",
        color: "warning.main",
        "@keyframes connectionPulse": {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.6 },
        },
      }}
    />
  );
};
