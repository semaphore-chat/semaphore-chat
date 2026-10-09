import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  communityControllerFindAllMineOptions,
  notificationsControllerGetUnreadCountOptions,
} from "../../api-client/@tanstack/react-query.gen";
import Drawer from "@mui/material/Drawer";
import Box from "@mui/material/Box";
import { styled } from "@mui/material/styles";
import { Divider, IconButton, Tooltip } from "@mui/material";
import ChatIcon from "@mui/icons-material/Chat";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import MenuIcon from "@mui/icons-material/Menu";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import { useParams, useNavigate } from "react-router-dom";
import CommunityListItem from "./CommunityListItem";
import CreateCommunityButton from "./CreateCommunityButton";
import { RailNavButton } from "./RailNavButton";
import { RailUserMenu } from "../Desktop/RailUserMenu";
import { useCanPerformAction } from "../../features/roles/useUserPermissions";
import { RBAC_ACTIONS } from "../../constants/rbacActions";
import { useReadReceipts } from "../../hooks/useReadReceipts";
import { RAIL_EXPANDED_WIDTH, SIDEBAR_WIDTH, VOICE_BAR_HEIGHT } from "../../constants/layout";
import type { User } from "../../types/auth.type";
import { logger } from "../../utils/logger";

interface CommunityToggleProps {
  isExpanded: boolean;
  onToggleExpanded: () => void;
  /** Opens the notification inbox (NotificationCenter). */
  onOpenNotifications: () => void;
  /** In a call the voice bar covers the bottom of the window: the rail stops above it. */
  voiceConnected: boolean;
  user: User | undefined;
}

const Rail = styled(Drawer, {
  shouldForwardProp: (prop) => prop !== "expanded" && prop !== "bottomInset",
})<{ expanded: boolean; bottomInset: number }>(({ expanded, bottomInset, theme }) => {
  const width = expanded ? RAIL_EXPANDED_WIDTH : SIDEBAR_WIDTH;
  const height = `calc(var(--full-dvh) - ${bottomInset}px)`;
  return {
    width,
    flexShrink: 0,
    zIndex: 1200,
    "&.MuiDrawer-root": { top: 0, height },
    "& .MuiDrawer-paper": {
      width,
      top: 0,
      height,
      boxSizing: "border-box",
      background: theme.palette.background.paper,
      borderRight: `1px solid ${theme.palette.divider}`,
      display: "flex",
      flexDirection: "column",
      transition: "width 0.3s cubic-bezier(0.4,0,0.2,1)",
      overflowX: "hidden",
    },
  };
});

const Section = styled(Box, {
  shouldForwardProp: (prop) => prop !== "expanded",
})<{ expanded: boolean }>(({ expanded, theme }) => ({
  display: "flex",
  flexDirection: "column",
  alignItems: expanded ? "stretch" : "center",
  gap: theme.spacing(1),
  padding: theme.spacing(0, expanded ? 1 : 0),
}));

/**
 * The desktop community rail. Top: Direct Messages and the notification inbox.
 * Middle (scrolls): communities and "create". Foot: the expand toggle and your
 * account menu. Expanded, it's a 160px labelled list.
 */
const CommunityToggle: React.FC<CommunityToggleProps> = ({
  isExpanded,
  onToggleExpanded,
  onOpenNotifications,
  voiceConnected,
  user,
}) => {
  const { data: rawCommunities, isLoading, error } = useQuery(communityControllerFindAllMineOptions());
  // The list can come back with a null entry (a community deleted while the
  // server built the response: it loads memberships, then their communities).
  // Skip it rather than crash the rail, but say so.
  const communities = React.useMemo(() => {
    const valid = rawCommunities?.filter((community) => community != null);
    if (rawCommunities && valid && valid.length !== rawCommunities.length) {
      logger.warn(`[CommunityRail] skipped ${rawCommunities.length - valid.length} null community entries from /communities/mine`);
    }
    return valid;
  }, [rawCommunities]);
  const { data: unread } = useQuery({
    ...notificationsControllerGetUnreadCountOptions(),
    refetchOnWindowFocus: true,
  });
  const { communityId } = useParams();
  const navigate = useNavigate();
  const canCreateCommunity = useCanPerformAction("INSTANCE", undefined, RBAC_ACTIONS.CREATE_COMMUNITY);
  const { totalDmUnreadCount: totalDmUnread } = useReadReceipts();
  const unreadNotifications = unread?.count ?? 0;

  return (
    <Rail
      variant="permanent"
      anchor="left"
      expanded={isExpanded}
      bottomInset={voiceConnected ? VOICE_BAR_HEIGHT : 0}
    >
      <Section expanded={isExpanded} sx={{ pt: 2, pb: 1 }}>
        <RailNavButton
          label="Messages"
          ariaLabel="Direct Messages"
          icon={<ChatIcon sx={{ color: "primary.contrastText" }} />}
          onClick={() => navigate("/direct-messages")}
          isExpanded={isExpanded}
          badgeContent={totalDmUnread}
        />
        <RailNavButton
          label="Notifications"
          ariaLabel={`Notifications, ${unreadNotifications} unread`}
          icon={<NotificationsNoneIcon sx={{ color: "text.primary" }} />}
          onClick={onOpenNotifications}
          isExpanded={isExpanded}
          badgeContent={unreadNotifications}
          avatarSx={{ bgcolor: "action.selected" }}
        />
      </Section>
      <Divider sx={{ mx: 2 }} />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", py: 1.5 }}>
        <Section expanded={isExpanded} sx={{ gap: 1.5 }}>
          {isLoading && <Box color="grey.500">Loading...</Box>}
          {error && <Box color="error.main">Error loading</Box>}
          {communities && communities.length > 0
            ? communities.map((community) => (
                <CommunityListItem
                  key={community.id}
                  community={community}
                  isExpanded={isExpanded}
                  selected={communityId === community.id}
                />
              ))
            : !isLoading && (
                <Box sx={{ color: "grey.500", fontSize: "scale.sm", textAlign: "center" }}>
                  No communities
                </Box>
              )}
          {canCreateCommunity && (
            <CreateCommunityButton isExpanded={isExpanded} onClick={() => navigate("/community/create")} />
          )}
        </Section>
      </Box>
      <Divider sx={{ mx: 2 }} />
      <Section expanded={isExpanded} sx={{ py: 1 }}>
        <Box sx={{ display: "flex", justifyContent: isExpanded ? "flex-start" : "center" }}>
          <Tooltip title={isExpanded ? "Collapse sidebar" : "Expand sidebar"} placement="right" arrow>
            <IconButton
              onClick={onToggleExpanded}
              aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
              aria-expanded={isExpanded}
            >
              {isExpanded ? <MenuOpenIcon /> : <MenuIcon />}
            </IconButton>
          </Tooltip>
        </Box>
        <RailUserMenu user={user} isExpanded={isExpanded} />
      </Section>
    </Rail>
  );
};

export default CommunityToggle;
