import React from "react";
import { Box } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { communityControllerFindAllMineOptions } from "../../api-client/@tanstack/react-query.gen";
import NewUserNextStep from "./NewUserNextStep";

/**
 * Phone/tablet "no community selected" panes: a user in no communities gets the
 * one next step (NewUserNextStep) instead of "pick a community"; everyone else
 * sees `children` (the existing pane).
 */
const ZeroCommunityGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { data: communities } = useQuery(communityControllerFindAllMineOptions());

  if (communities && communities.length === 0) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", p: 2, overflowY: "auto" }}>
        <NewUserNextStep />
      </Box>
    );
  }
  return <>{children}</>;
};

export default ZeroCommunityGate;
