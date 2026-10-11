import React from "react";
import {
  ListItem,
  ListItemAvatar,
  ListItemText,
  IconButton,
  Tooltip,
  Box,
} from "@mui/material";
import {
  Check as AcceptIcon,
  Close as DeclineIcon,
  Cancel as CancelIcon,
} from "@mui/icons-material";
import { Friendship } from "../../types/friend.type";
import UserAvatar from "../Common/UserAvatar";

interface FriendRequestCardProps {
  request: Friendship;
  type: "received" | "sent";
  onAccept?: (friendshipId: string) => void;
  onDecline?: (friendshipId: string) => void;
  onCancel?: (friendshipId: string) => void;
}

const FriendRequestCard: React.FC<FriendRequestCardProps> = ({
  request,
  type,
  onAccept,
  onDecline,
  onCancel,
}) => {
  // Get the other user (sender for received, receiver for sent)
  const otherUser =
    type === "received"
      ? request.userA // Sender
      : request.userB; // Receiver

  if (!otherUser) {
    return null;
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return "Today";
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  return (
    <ListItem
      // Room for the actions (two buttons for a received request, one for a
      // sent one), so a long name ends in an ellipsis instead of running under them.
      sx={{ pr: type === "received" ? 12 : 8 }}
      secondaryAction={
        <Box sx={{ display: "flex", gap: 1 }}>
          {type === "received" && onAccept && onDecline && (
            <>
              <Tooltip title="Accept">
                <IconButton
                  color="success"
                  onClick={() => onAccept(request.id)}
                  size="small"
                >
                  <AcceptIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Decline">
                <IconButton
                  color="error"
                  onClick={() => onDecline(request.id)}
                  size="small"
                >
                  <DeclineIcon />
                </IconButton>
              </Tooltip>
            </>
          )}
          {type === "sent" && onCancel && (
            <Tooltip title="Cancel Request">
              <IconButton
                color="error"
                onClick={() => onCancel(request.id)}
                size="small"
              >
                <CancelIcon />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      }
    >
      <ListItemAvatar>
        <UserAvatar userId={otherUser.id} size="medium" />
      </ListItemAvatar>
      <ListItemText
        slotProps={{ primary: { noWrap: true } }}
        primary={otherUser.displayName || otherUser.username}
        secondary={
          type === "received"
            ? `Sent ${formatDate(request.createdAt)}`
            : `Pending since ${formatDate(request.createdAt)}`
        }
      />
    </ListItem>
  );
};

export default FriendRequestCard;
