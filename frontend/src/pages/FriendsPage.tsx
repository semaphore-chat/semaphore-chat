import React from "react";
import { useNavigate } from "react-router-dom";
import { Box, Paper } from "@mui/material";
import { styled } from "@mui/material/styles";
import { FriendsPanel } from "../components/Friends";
import { useResponsive } from "../hooks/useResponsive";

// Desktop: a centred card floating over the page. The side padding keeps it
// off the sidebar and the window edge when the window is barely wider than
// the card (an Electron window can be 800px).
const Root = styled(Box)({
  display: "flex",
  height: "100%",
  width: "100%",
  position: "absolute",
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  justifyContent: "center",
  alignItems: "flex-start",
  paddingTop: 32,
  paddingLeft: 16,
  paddingRight: 16,
});

const Container = styled(Paper)(({ theme }) => ({
  width: "100%",
  maxWidth: 800,
  height: "calc(100% - 64px)",
  display: "flex",
  flexDirection: "column",
  borderRadius: Number(theme.shape.borderRadius) * 2,
  overflow: "hidden",
}));

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

  return (
    <Root>
      <Container elevation={3}>
        <FriendsPanel onSelectDmGroup={handleSelectDmGroup} />
      </Container>
    </Root>
  );
};

export default FriendsPage;
