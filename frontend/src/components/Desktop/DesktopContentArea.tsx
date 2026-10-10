import React from "react";
import { Box } from "@mui/material";
import { Outlet } from "react-router-dom";
import { RAIL_EXPANDED_WIDTH, SIDEBAR_WIDTH, VOICE_BAR_HEIGHT } from "../../constants/layout";
import { RouteErrorBoundary } from "../RouteErrorBoundary";
import { useTopChromeHeight } from "../../contexts/BottomChromeContext";

/** Content area that hosts the routed page content */
export const DesktopContentArea: React.FC<{ voiceConnected: boolean; isMenuExpanded: boolean }> = ({
  voiceConnected,
  isMenuExpanded,
}) => {
  // The incoming-call banner sits above the page: start the page below it
  const topInset = useTopChromeHeight();
  return (
    <Box
      sx={{
        position: "absolute",
        top: topInset,
        left: isMenuExpanded ? RAIL_EXPANDED_WIDTH : SIDEBAR_WIDTH,
        right: 0,
        bottom: voiceConnected ? VOICE_BAR_HEIGHT : 0,
        overflow: "auto",
        transition: "left 0.3s cubic-bezier(0.4,0,0.2,1)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ flex: 1, minHeight: "100%" }}>
        {/*
          Panel-level seam: wraps only the routed page content so a crash in
          any single page/panel leaves the community rail and the
          voice bottom bar (siblings of DesktopContentArea, rendered below)
          mounted and functional. This is the boundary that keeps the desktop
          shell alive — see App.tsx for the outer RouteErrorBoundary that
          covers everything else (including Layout itself).
        */}
        <RouteErrorBoundary>
          <Outlet />
        </RouteErrorBoundary>
      </Box>
    </Box>
  );
};

export default DesktopContentArea;
