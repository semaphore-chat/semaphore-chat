import React, { useState } from "react";
import {
  Box,
  Button,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemButton,
  Divider,
  Skeleton,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import UserAvatar from "../Common/UserAvatar";
import ListState from "../Common/ListState";
import { UserModerationMenu } from "../Moderation";
import { useUserProfile } from "../../contexts/UserProfileContext";
import { useResponsive } from "../../hooks/useResponsive";
import { useLongPress } from "../../hooks/useSwipeGesture";
import { useContextMenuFocusRestore } from "../../hooks/useContextMenuFocusRestore";

export interface MemberData {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  isOnline?: boolean;
  status?: string | null;
  displayRole?: { id: string; name: string; position: number };
}

interface MemberListProps {
  members: MemberData[];
  isLoading?: boolean;
  error?: unknown;
  title?: string;
  communityId?: string; // For moderation actions
  /** True when more members can be loaded (paginated community list). */
  hasMore?: boolean;
  /** True while the next page of members is being fetched. */
  isLoadingMore?: boolean;
  /** Load the next page of members. */
  onLoadMore?: () => void;
  /** Retry after a failed load (shown in the error state). */
  onRetry?: () => void;
}

const MemberListSkeleton: React.FC = () => (
  <ListItem sx={{ px: 1, py: 0.5 }}>
    <ListItemAvatar sx={{ minWidth: 40 }}>
      <Skeleton variant="circular" width={32} height={32} />
    </ListItemAvatar>
    <ListItemText
      primary={<Skeleton variant="text" width="60%" />}
      secondary={<Skeleton variant="text" width="40%" />}
    />
  </ListItem>
);

interface ContextMenuState {
  position: { top: number; left: number } | null;
  member: MemberData | null;
}

interface RoleGroup {
  roleId: string;
  roleName: string;
  position: number;
  members: MemberData[];
}

/**
 * Section header for role groups and online/offline sections.
 * Styled like Discord's uppercase, muted section headers.
 */
const SectionHeader: React.FC<{ label: string; count: number }> = ({ label, count }) => (
  <ListItem sx={{ px: 2, pt: 2, pb: 0.5 }}>
    <Typography
      variant="overline"
      sx={{
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.05em",
        color: "text.secondary",
        lineHeight: 1.5,
      }}
    >
      {label} — {count}
    </Typography>
  </ListItem>
);

/**
 * A single member row. Left-click / tap opens the profile; right-click (desktop)
 * or long-press (touch) opens the moderation menu anchored at the pointer.
 */
const MemberRow: React.FC<{
  member: MemberData;
  onOpenProfile: (userId: string) => void;
  onOpenMenu: (position: { top: number; left: number }, member: MemberData, triggerEl: HTMLElement | null) => void;
}> = React.memo(function MemberRow({ member, onOpenProfile, onOpenMenu }) {
  const theme = useTheme();
  const { shouldUseTouchUI } = useResponsive();
  const rowRef = React.useRef<HTMLDivElement>(null);

  const longPress = useLongPress(
    (point) => {
      if (point) onOpenMenu({ top: point.y, left: point.x }, member, rowRef.current);
    },
    { enabled: shouldUseTouchUI },
  );

  const interactionProps = shouldUseTouchUI
    ? {
        onTouchStart: longPress.onTouchStart,
        onTouchMove: longPress.onTouchMove,
        onTouchEnd: longPress.onTouchEnd,
        onTouchCancel: longPress.onTouchCancel,
        onContextMenu: longPress.onContextMenu,
      }
    : {
        onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
          e.preventDefault();
          onOpenMenu({ top: e.clientY, left: e.clientX }, member, e.currentTarget);
        },
      };

  return (
    <ListItemButton
      ref={rowRef}
      onClick={() => {
        // Ignore the ghost click some browsers (iOS) fire after a long-press —
        // otherwise the profile opens on top of the moderation menu.
        if (longPress.isLongPressTriggered()) return;
        onOpenProfile(member.id);
      }}
      {...interactionProps}
      sx={{
        px: 2,
        py: 0.5,
       ...(shouldUseTouchUI && {
         WebkitTouchCallout: "none",
         userSelect: "none",
       }),
        "&:hover": {
          backgroundColor: theme.palette.semantic.overlay.light,
        },
      }}
    >
      <ListItemAvatar sx={{ minWidth: 40 }}>
        <UserAvatar
          userId={member.id}
          size="small"
          showStatus={true}
          isOnline={member.isOnline}
        />
      </ListItemAvatar>
      <ListItemText
        primary={
          <Typography
            variant="body2"
            sx={{
              fontWeight: 500,
              fontSize: "14px",
              lineHeight: 1.2,
            }}
          >
            {member.displayName || member.username}
          </Typography>
        }
        secondary={
          member.status ? (
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                fontSize: "11px",
                lineHeight: 1.2,
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 150,
              }}
            >
              {member.status}
            </Typography>
          ) : null
        }
      />
    </ListItemButton>
  );
});

const MemberList: React.FC<MemberListProps> = ({
  members,
  isLoading = false,
  error = null,
  title = "Members",
  communityId,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  onRetry,
}) => {
  const { openProfile } = useUserProfile();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    position: null,
    member: null,
  });
  const { captureTrigger, restoreFocus } = useContextMenuFocusRestore();
  // Fallback restore target: the member row that opened the menu can
  // unmount while the menu is closing (e.g. the member goes offline and is
  // re-sorted/removed from view). The scroll container outlives any
  // individual row, so it's a safe place to land focus in that case.
  const listContainerRef = React.useRef<HTMLDivElement>(null);

  const openMenu = React.useCallback(
    (position: { top: number; left: number }, member: MemberData, triggerEl: HTMLElement | null) => {
      captureTrigger(triggerEl);
      setContextMenu({ position, member });
    },
    [captureTrigger],
  );

  const handleCloseContextMenu = () => {
    setContextMenu({ position: null, member: null });
    // anchorPosition menus have no anchor element for MUI to auto-restore
    // focus to on close — return it to the member row that opened this,
    // falling back to the scroll container if that row unmounted while
    // the menu was closing.
    restoreFocus(listContainerRef.current);
  };

  // Group members by display role
  const { roleGroups, onlineMembers, offlineMembers } = React.useMemo(() => {
    const groupMap = new Map<string, RoleGroup>();
    const ungroupedOnline: MemberData[] = [];
    const ungroupedOffline: MemberData[] = [];

    for (const member of members) {
      if (member.displayRole) {
        const key = member.displayRole.id;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            roleId: member.displayRole.id,
            roleName: member.displayRole.name,
            position: member.displayRole.position,
            members: [],
          });
        }
        groupMap.get(key)!.members.push(member);
      } else if (member.isOnline) {
        ungroupedOnline.push(member);
      } else {
        ungroupedOffline.push(member);
      }
    }

    // Sort role groups by position (lowest first = highest priority)
    const sortedGroups = Array.from(groupMap.values()).sort(
      (a, b) => a.position - b.position,
    );

    // Sort members within each group: online first, then alphabetically
    for (const group of sortedGroups) {
      group.members.sort((a, b) => {
        if (a.isOnline && !b.isOnline) return -1;
        if (!a.isOnline && b.isOnline) return 1;
        return (a.displayName || a.username).localeCompare(b.displayName || b.username);
      });
    }

    // Sort ungrouped members alphabetically
    ungroupedOnline.sort((a, b) =>
      (a.displayName || a.username).localeCompare(b.displayName || b.username),
    );
    ungroupedOffline.sort((a, b) =>
      (a.displayName || a.username).localeCompare(b.displayName || b.username),
    );

    return {
      roleGroups: sortedGroups,
      onlineMembers: ungroupedOnline,
      offlineMembers: ungroupedOffline,
    };
  }, [members]);

  const renderMember = (member: MemberData) => (
    <MemberRow
      key={member.id}
      member={member}
      onOpenProfile={openProfile}
      onOpenMenu={openMenu}
    />
  );

  return (
    <Box
      sx={{
        width: 240,
        height: "100%",
        borderLeft: 1,
        borderColor: "divider",
        backgroundColor: "background.paper",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="h6" sx={{ fontSize: "14px", fontWeight: 600 }}>
          {title}
          {!error && ` — ${isLoading ? "..." : `${members.length}${hasMore ? "+" : ""}`}`}
        </Typography>
      </Box>
      <Divider />

      {/* Member List */}
      <Box
        ref={listContainerRef}
        tabIndex={-1}
        sx={{
          flex: 1,
          overflowY: "auto",
          "&::-webkit-scrollbar": {
            width: 8,
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: alpha("#000", 0.2),
            borderRadius: 4,
          },
        }}
      >
        <ListState
          isLoading={isLoading}
          error={error}
          onRetry={onRetry}
          isEmpty={members.length === 0}
          size="compact"
          errorTitle="Couldn't load members"
          skeleton={
            <List disablePadding role="progressbar" aria-label="Loading members" aria-busy="true">
              {Array.from({ length: 6 }).map((_, index) => (
                <MemberListSkeleton key={index} />
              ))}
            </List>
          }
          empty={
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                py: 4,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                No members
              </Typography>
            </Box>
          }
        >
          <List disablePadding>
            {/* Role groups */}
            {roleGroups.map((group) => (
              <React.Fragment key={group.roleId}>
                <SectionHeader label={group.roleName} count={group.members.length} />
                {group.members.map(renderMember)}
              </React.Fragment>
            ))}

            {/* Online members without special roles */}
            {onlineMembers.length > 0 && (
              <>
                <SectionHeader label="Online" count={onlineMembers.length} />
                {onlineMembers.map(renderMember)}
              </>
            )}

            {/* Offline members without special roles */}
            {offlineMembers.length > 0 && (
              <>
                <SectionHeader label="Offline" count={offlineMembers.length} />
                {offlineMembers.map(renderMember)}
              </>
            )}

            {/* Load next page of the paginated community member list */}
            {hasMore && onLoadMore && (
              <ListItem sx={{ px: 2, py: 1 }}>
                <Button
                  size="small"
                  fullWidth
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? "Loading..." : "Show more"}
                </Button>
              </ListItem>
            )}
          </List>
        </ListState>
      </Box>

      {/* Moderation Context Menu */}
      {contextMenu.member && (
        <UserModerationMenu
          anchorEl={null}
          anchorPosition={contextMenu.position ?? undefined}
          open={Boolean(contextMenu.position)}
          onClose={handleCloseContextMenu}
          targetUserId={contextMenu.member.id}
          targetUserName={contextMenu.member.username}
          communityId={communityId || ""}
          onViewProfile={() => {
            handleCloseContextMenu();
            openProfile(contextMenu.member!.id);
          }}
        />
      )}
    </Box>
  );
};

export default MemberList;