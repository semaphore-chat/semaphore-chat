import React from "react";
import { useNavigate } from "react-router-dom";
import { Paper } from "@mui/material";
import { ListPageShell } from "../components/Common/PageShell";
import { FriendsPanel } from "../components/Friends";
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
    <ListPageShell fillHeight>
      <Paper
        variant="outlined"
        sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 2 }}
      >
        <FriendsPanel onSelectDmGroup={handleSelectDmGroup} />
      </Paper>
    </ListPageShell>
  );
};

export default FriendsPage;
