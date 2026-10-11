import React from "react";
import { useNavigate } from "react-router-dom";
import { Box, Paper, Typography } from "@mui/material";
import { ListPageShell, useShellWidth } from "../components/Common/PageShell";
import { AddFriendForm, FriendRequestList, FriendsPanel } from "../components/Friends";
import {
  FRIENDS_LIST_MAX_WIDTH,
  FRIENDS_SIDE_PANEL_WIDTH,
  FRIENDS_SPLIT_PX,
  PAGE_WIDE_MAX_WIDTH,
} from "../constants/layout";
import { useResponsive } from "../hooks/useResponsive";

const FriendsPage: React.FC = () => {
  const navigate = useNavigate();
  const { isMobile, isTablet } = useResponsive();

  const handleSelectDmGroup = (dmGroupId: string) => {
    navigate(`/direct-messages/${dmGroupId}`);
  };

  // Phone / tablet: the page renders inside the screen's scroll area below
  // the app bar (which already says "Friends"), so fill it in normal flow
  // instead of floating an absolutely positioned card over the whole layer.
  if (isMobile || isTablet) {
    return (
      <Paper
        square
        elevation={0}
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <FriendsPanel onSelectDmGroup={handleSelectDmGroup} hideTitle />
      </Paper>
    );
  }

  // Desktop: the list page shell, the panel filling its height (no floating card).
  return (
    <ListPageShell fillHeight maxWidth={PAGE_WIDE_MAX_WIDTH} align="center">
      <DesktopFriends onSelectDmGroup={handleSelectDmGroup} />
    </ListPageShell>
  );
};

const cardSx = {
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  borderRadius: 2,
} as const;

/**
 * Below FRIENDS_SPLIT_PX of shell width: one centred card with All | Pending
 * tabs. From it: the friend list, and beside it a side panel with the
 * add-friend form and the pending requests.
 */
const DesktopFriends: React.FC<{ onSelectDmGroup: (dmGroupId: string) => void }> = ({ onSelectDmGroup }) => {
  const width = useShellWidth();
  const split = width !== null && width >= FRIENDS_SPLIT_PX;

  if (!split) {
    return (
      <Paper
        variant="outlined"
        data-testid="friends-layout"
        data-layout="tabs"
        sx={{ ...cardSx, flex: 1, width: "100%", maxWidth: FRIENDS_LIST_MAX_WIDTH, mx: "auto" }}
      >
        <FriendsPanel onSelectDmGroup={onSelectDmGroup} />
      </Paper>
    );
  }

  return (
    <Box
      data-testid="friends-layout"
      data-layout="split"
      sx={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: `minmax(0, ${FRIENDS_LIST_MAX_WIDTH}px) ${FRIENDS_SIDE_PANEL_WIDTH}px`,
        gridTemplateRows: "minmax(0, 1fr)",
        justifyContent: "center",
        gap: 3,
      }}
    >
      <Paper variant="outlined" sx={cardSx}>
        <FriendsPanel onSelectDmGroup={onSelectDmGroup} layout="list" />
      </Paper>
      <Box component="aside" aria-label="Add friends and requests" sx={{ minHeight: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <Paper variant="outlined" sx={{ borderRadius: 2, p: 2, flexShrink: 0 }}>
          <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
            Add friend
          </Typography>
          <AddFriendForm />
        </Paper>
        <Paper variant="outlined" sx={{ ...cardSx, flex: 1 }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
            <Typography variant="h6" component="h2">
              Pending requests
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <FriendRequestList compact />
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default FriendsPage;
