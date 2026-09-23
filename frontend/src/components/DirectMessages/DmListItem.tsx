/**
 * DmListItem Component
 *
 * Shared component that renders a single DM group list item.
 * Used by both DirectMessageList (desktop) and MobileMessagesPanel (mobile).
 */

import React from "react";
import {
  Badge,
  Box,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  Avatar,
  Typography,
} from "@mui/material";
import { Group as GroupIcon, Phone } from "@mui/icons-material";
import { visuallyHidden } from "@mui/utils";

import UserAvatar from "../Common/UserAvatar";
import { getDmOtherUser, formatLastMessageTime } from "../../utils/dmHelpers";
import { getCompactDmName } from "../../utils/dmListName";
import type { DirectMessageGroup } from "../../types/direct-message.type";

interface DmListItemProps {
  group: DirectMessageGroup;
  currentUserId: string | undefined;
  isSelected?: boolean;
  onClick: () => void;
  touchFriendly?: boolean;
  isInCall?: boolean;
  unreadCount?: number;
  mentionCount?: number;
  isOnline?: boolean;
}

/**
 * One row: [avatar] [name ........ time]
 *                   [preview ... badge]
 *
 * The timestamp always sits on the name row, so it doesn't move depending on
 * whether a badge is showing. There is exactly one unread indicator: a dot for
 * a single unread message, otherwise a count (capped at 99+).
 */
const DmListItem: React.FC<DmListItemProps> = ({
  group,
  currentUserId,
  isSelected = false,
  onClick,
  touchFriendly = false,
  isInCall = false,
  unreadCount = 0,
  mentionCount = 0,
  isOnline = false,
}) => {
  const badgeCount = Math.max(unreadCount, mentionCount);
  const isUnread = badgeCount > 0 && !isSelected;
  const { names, extra, full: fullName } = getCompactDmName(group, currentUserId);
  const preview = group.lastMessage
    ? group.lastMessage.spans.find((s) => s.type === "PLAINTEXT")?.text || "Message"
    : "No messages yet";

  return (
    <ListItem disablePadding>
      <ListItemButton
        selected={isSelected}
        onClick={onClick}
        sx={{
          borderRadius: 1,
          margin: "4px 0",
          padding: "8px 16px",
          minWidth: 0,
          ...(touchFriendly && { minHeight: 56 }),
          "&.Mui-selected": {
            backgroundColor: "action.selected",
          },
        }}
      >
        <ListItemAvatar>
          {group.isGroup ? (
            <Avatar sx={{ bgcolor: "secondary.main" }}>
              <GroupIcon />
            </Avatar>
          ) : (
            <UserAvatar userId={getDmOtherUser(group, currentUserId)?.id} size="medium" showStatus isOnline={isOnline} />
          )}
        </ListItemAvatar>
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.25 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            <Box
              component="span"
              data-testid="dm-name"
              title={extra > 0 ? fullName : undefined}
              sx={{ display: "flex", alignItems: "baseline", gap: 0.5, flex: "0 1 auto", minWidth: 0 }}
            >
              <Typography
                component="span"
                noWrap
                // RTL names/previews truncate at their own end (keep the first word).
                dir="auto"
                sx={{ minWidth: 0, fontWeight: isUnread ? 700 : 500 }}
              >
                {names}
              </Typography>
              {/* Whitespace for textContent / screen readers; flex drops it visually. */}
              {extra > 0 && " "}
              {extra > 0 && (
                <Typography
                  component="span"
                  noWrap
                  sx={{ flexShrink: 0, fontWeight: isUnread ? 700 : 500, color: "text.secondary" }}
                >
                  {`+ ${extra}`}
                </Typography>
              )}
            </Box>
            {isInCall && (
              <Phone aria-label="In call" titleAccess="In call" sx={{ fontSize: 'icon.sm', color: "success.main", flexShrink: 0 }} />
            )}
            {group.lastMessage && (
              <Typography
                component="span"
                variant="caption"
                data-testid="dm-last-time"
                noWrap
                sx={{
                  ml: "auto",
                  pl: 1,
                  flexShrink: 0,
                  // Unread is carried by weight + the badge; the accent colour
                  // fails AA contrast at caption size on light grounds.
                  color: isUnread ? "text.primary" : "text.secondary",
                  fontWeight: isUnread ? 600 : undefined,
                }}
              >
                {formatLastMessageTime(group.lastMessage.sentAt)}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <Typography
              component="span"
              variant="body2"
              noWrap
              dir="auto"
              sx={{ flex: 1, minWidth: 0, textAlign: "left", color: isUnread ? "text.primary" : "text.secondary" }}
            >
              {preview}
            </Typography>
            {isUnread && (
              <Badge
                data-testid="unread-badge"
                badgeContent={badgeCount === 1 ? undefined : badgeCount}
                variant={badgeCount === 1 ? "dot" : "standard"}
                color="error"
                max={99}
                // aria-label on the Badge's plain span isn't announced; the
                // visually hidden text below carries the count instead.
                aria-hidden
                sx={{
                  flexShrink: 0,
                  mr: badgeCount === 1 ? 0.5 : 0,
                  "& .MuiBadge-badge": {
                    position: "static",
                    transform: "none",
                  },
                  "& .MuiBadge-dot": {
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                  },
                  "& .MuiBadge-standard": {
                    fontSize: 'scale.xs',
                    height: 18,
                    minWidth: 18,
                  },
                }}
              />
            )}
            {isUnread && (
              <Box component="span" sx={visuallyHidden}>
                {`${badgeCount} unread`}
              </Box>
            )}
          </Box>
        </Box>
      </ListItemButton>
    </ListItem>
  );
};

export default React.memo(DmListItem);
