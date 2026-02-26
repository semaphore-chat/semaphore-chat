import React from "react";
import {
  ListItem,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
} from "@mui/material";
import {
  MoreVert as MoreIcon,
  Message as MessageIcon,
  PersonRemove as RemoveIcon,
} from "@mui/icons-material";
import UserAvatar from "../Common/UserAvatar";
import type { FriendListItemDto } from "../../api-client/types.gen";

type FriendSummary = Pick<FriendListItemDto, "id" | "username" | "displayName" | "avatarUrl">;

interface FriendCardProps {
  friend: FriendSummary;
  friendshipId: string;
  onMessage: (userId: string) => void;
  onRemove: (friendshipId: string) => void;
}

const FriendCard: React.FC<FriendCardProps> = ({
  friend,
  friendshipId,
  onMessage,
  onRemove,
}) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleMessage = () => {
    handleMenuClose();
    onMessage(friend.id);
  };

  const handleRemove = () => {
    handleMenuClose();
    onRemove(friendshipId);
  };

  return (
    <ListItem
      disablePadding
      secondaryAction={
        <IconButton edge="end" onClick={handleMenuOpen}>
          <MoreIcon />
        </IconButton>
      }
    >
      <ListItemButton onClick={handleMessage}>
        <ListItemAvatar>
          <UserAvatar user={friend} size="medium" />
        </ListItemAvatar>
        <ListItemText
          primary={friend.displayName || friend.username}
          secondary={`@${friend.username}`}
        />
      </ListItemButton>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={handleMessage}>
          <ListItemIcon>
            <MessageIcon fontSize="small" />
          </ListItemIcon>
          Message
        </MenuItem>
        <MenuItem onClick={handleRemove} sx={{ color: "error.main" }}>
          <ListItemIcon>
            <RemoveIcon fontSize="small" color="error" />
          </ListItemIcon>
          Remove Friend
        </MenuItem>
      </Menu>
    </ListItem>
  );
};

export default FriendCard;
