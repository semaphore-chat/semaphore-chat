import React from "react";
import { useQuery } from "@tanstack/react-query";
import { communityControllerFindAllMineOptions } from "../../api-client/@tanstack/react-query.gen";
import Drawer from "@mui/material/Drawer";
import Box from "@mui/material/Box";
import { styled } from "@mui/system";
import { useResponsive } from "../../hooks/useResponsive";
import CommunityListItem from "./CommunityListItem";
import CreateCommunityButton from "./CreateCommunityButton";
import { useParams, useNavigate } from "react-router-dom";
import { Tooltip, Button, Avatar, Badge } from "@mui/material";
import ChatIcon from "@mui/icons-material/Chat";
import { useCanPerformAction } from "../../features/roles/useUserPermissions";
import { RBAC_ACTIONS } from "../../constants/rbacActions";
import { useReadReceipts } from "../../hooks/useReadReceipts";

export interface Community {
  id: string;
  name: string;
  avatar?: string | null;
  banner?: string | null;
  description?: string | null;
  createdAt: Date;
}

interface CommunityToggleProps {
  isExpanded: boolean;
  appBarHeight: number;
}

const COLLAPSED_WIDTH = 80;
const EXPANDED_WIDTH = 320;

const Sidebar = styled(Drawer, {
  shouldForwardProp: (prop) =>
    prop !== "appBarHeight" && prop !== "expanded" && prop !== "isMobile",
})<{
  appBarHeight: number;
  expanded: boolean;
  isMobile: boolean;
}>(({ appBarHeight, expanded, isMobile, theme }) => ({
  width: expanded ? (isMobile ? "100vw" : EXPANDED_WIDTH) : COLLAPSED_WIDTH,
  flexShrink: 0,
  zIndex: 1200,
  "& .MuiDrawer-paper": {
    width: expanded ? (isMobile ? "100vw" : EXPANDED_WIDTH) : COLLAPSED_WIDTH,
    boxSizing: "border-box",
    background: theme.palette.background.paper,
    borderRight: `1px solid ${theme.palette.divider}`,
    display: "flex",
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 16,
    top: appBarHeight,
    height: `calc(100vh - ${appBarHeight}px)`,
    transition: "width 0.3s cubic-bezier(0.4,0,0.2,1)",
    overflowX: "hidden",
  },
  "&.MuiDrawer-root": {
    top: appBarHeight,
    height: `calc(100vh - ${appBarHeight}px)`,
  },
}));

const CommunityList = styled(Box, {
  shouldForwardProp: (prop) => prop !== "expanded",
})<{ expanded: boolean }>(({ expanded }) => {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: expanded ? "stretch" : "center",
    gap: 12,
    width: "100%",
    paddingRight: expanded ? 4 : 0,
    paddingLeft: expanded ? 4 : 0,
  };
});

const CommunityToggle: React.FC<CommunityToggleProps> = ({
  appBarHeight,
  isExpanded,
}) => {
  const { data: communities, isLoading, error } = useQuery(communityControllerFindAllMineOptions());
  const { isMobile } = useResponsive();
  const { communityId } = useParams();
  const navigate = useNavigate();
  const canCreateCommunity = useCanPerformAction("INSTANCE", undefined, RBAC_ACTIONS.CREATE_COMMUNITY);
  const { totalDmUnreadCount: totalDmUnread } = useReadReceipts();

  const handleCreateCommunity = () => {
    // Navigate to create community page (you may need to adjust this route)
    navigate("/community/create");
  };

  const handleDirectMessages = () => {
    navigate("/direct-messages");
  };

  return (
    <Sidebar
      variant="permanent"
      anchor="left"
      appBarHeight={appBarHeight}
      expanded={isExpanded}
      isMobile={isMobile}
    >
      <Box
        sx={{
          width: "100%",
          display: "flex",
          justifyContent: isExpanded ? "flex-end" : "center",
          mb: 2,
        }}
      ></Box>
      <CommunityList expanded={isExpanded}>
        {/* Direct Messages button at the top */}
        <Box sx={{ mb: 2 }}>
          {isExpanded ? (
            <Button
              onClick={handleDirectMessages}
              variant="text"
              sx={{ 
                width: "90%", 
                padding: 0,
                justifyContent: "flex-start",
              }}
            >
              <Box
                sx={{
                  position: "relative",
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  borderRadius: 2,
                  overflow: "hidden",
                  padding: "8px",
                  transition: "background 0.2s, box-shadow 0.2s",
                  "&:hover": {
                    backgroundColor: "action.hover",
                  },
                }}
              >
                <Badge
                  badgeContent={totalDmUnread}
                  color="error"
                  max={99}
                  overlap="circular"
                >
                  <Avatar
                    sx={{
                      width: 48,
                      height: 48,
                      bgcolor: "primary.main",
                      mr: 2,
                    }}
                  >
                    <ChatIcon sx={{ color: "primary.contrastText" }} />
                  </Avatar>
                </Badge>
                <Box sx={{ textAlign: "left", textTransform: "none" }}>
                  <Box sx={{ fontSize: 14, fontWeight: 600, color: "text.primary" }}>
                    Direct Messages
                  </Box>
                </Box>
              </Box>
            </Button>
          ) : (
            <Tooltip title="Direct Messages" placement="right" arrow>
              <Button
                onClick={handleDirectMessages}
                variant="text"
                sx={{ width: "90%", padding: 0 }}
              >
                <Badge
                  badgeContent={totalDmUnread}
                  color="error"
                  max={99}
                  overlap="circular"
                >
                  <Avatar
                    sx={{
                      width: 48,
                      height: 48,
                      bgcolor: "primary.main",
                    }}
                  >
                    <ChatIcon sx={{ color: "primary.contrastText" }} />
                  </Avatar>
                </Badge>
              </Button>
            </Tooltip>
          )}
        </Box>
        
        {isLoading && <Box color="grey.500">Loading...</Box>}
        {error && <Box color="error.main">Error loading</Box>}
        {communities && communities.length > 0
          ? communities.map((community: Community) => (
              <CommunityListItem
                key={community.id}
                community={community}
                isExpanded={isExpanded}
                selected={communityId === community.id}
              />
            ))
          : !isLoading && (
              <Box color="grey.500" fontSize={12}>
                No communities
              </Box>
            )}
        {canCreateCommunity && (
          <CreateCommunityButton
            isExpanded={isExpanded}
            onClick={handleCreateCommunity}
          />
        )}
      </CommunityList>
    </Sidebar>
  );
};

export default CommunityToggle;
