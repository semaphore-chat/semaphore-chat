/**
 * DmListItem Component
 *
 * Shared component that renders a single DM group list item.
 * Used by both DirectMessageList (desktop) and MobileMessagesPanel (mobile).
 */

import React from "react";
import {
  Box,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
} from "@mui/material";
import { Group as GroupIcon, Phone } from "@mui/icons-material";

import UserAvatar from "../Common/UserAvatar";
import { getDmDisplayName, getDmOtherUser, formatLastMessageTime } from "../../utils/dmHelpers";
import type { DirectMessageGroup } from "../../types/direct-message.type";

interface DmListItemProps {
  group: DirectMessageGroup;
  currentUserId: string | undefined;
  isSelected?: boolean;
  onClick: () => void;
  touchFriendly?: boolean;
  isInCall?: boolean;
}

const DmListItem: React.FC<DmListItemProps> = ({
  group,
  currentUserId,
  isSelected = false,
  onClick,
  touchFriendly = false,
  isInCall = false,
}) => {
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
            <UserAvatar user={getDmOtherUser(group, currentUserId)} size="medium" />
          )}
        </ListItemAvatar>
        <ListItemText
          primary={
            <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {getDmDisplayName(group, currentUserId)}
              {isInCall && (
                <Phone sx={{ fontSize: 14, color: "success.main" }} />
              )}
            </Box>
          }
          secondary={
            group.lastMessage ? (
              <Box
                component="span"
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  minWidth: 0,
                }}
              >
                <Box
                  component="span"
                  sx={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {group.lastMessage.spans.find((s) => s.type === "PLAINTEXT")?.text || "Message"}
                </Box>
                <Box
                  component="span"
                  sx={{
                    ml: 1,
                    fontSize: "0.75rem",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatLastMessageTime(group.lastMessage.sentAt)}
                </Box>
              </Box>
            ) : (
              "No messages yet"
            )
          }
          sx={{ minWidth: 0 }}
        />
      </ListItemButton>
    </ListItem>
  );
};

export default React.memo(DmListItem);
