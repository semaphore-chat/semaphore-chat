/**
 * MessageContextMenu
 *
 * Right-click context menu for messages (web and Electron).
 * Quick-reaction row on top, then reply, thread, react, edit, pin, copy and,
 * after a divider, delete.
 */

import React, { useCallback } from 'react';
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import type { Message } from '../../types/message.type';
import { getMessageActions, type MessageAction } from './messageActions';
import { useQueryClient } from "@tanstack/react-query";
import { QUICK_REACTIONS } from './emojiData';
import { findCachedChannel } from "../../hooks/useChannelMentionTarget";

const quickReactionSx = {
  display: 'inline-flex',
  width: 'auto',
  minWidth: 0,
  minHeight: 0,
  px: 1,
  py: 0.5,
  borderRadius: 1,
  fontSize: 'icon.lg',
  verticalAlign: 'top',
} as const;

export interface MessageContextMenuProps {
  anchorPosition: { top: number; left: number } | null;
  open: boolean;
  onClose: () => void;
  message: Message;
  // Permissions
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  canReact: boolean;
  canThread: boolean;
  isPinned: boolean;
  // Actions
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onReplyInThread: () => void;
  onQuoteReply?: () => void;
  onAddReaction: () => void;
  /** Adds a specific reaction from the quick-reaction row (row hidden without it). */
  onEmojiSelect?: (emoji: string) => void;
}

const MessageContextMenu: React.FC<MessageContextMenuProps> = ({
  anchorPosition,
  open,
  onClose,
  message,
  canEdit,
  canDelete,
  canPin,
  canReact,
  canThread,
  isPinned,
  onEdit,
  onDelete,
  onPin,
  onUnpin,
  onReplyInThread,
  onQuoteReply,
  onAddReaction,
  onEmojiSelect,
}) => {
  const queryClient = useQueryClient();
  const actions = getMessageActions({
    message,
    channelName: (id) => findCachedChannel(queryClient, id)?.name,
    canEdit,
    canDelete,
    canPin,
    canReact,
    canThread,
    isPinned,
    handlers: {
      onEdit,
      onDelete,
      onPin,
      onUnpin,
      onReplyInThread,
      onQuoteReply,
      onAddReaction,
    },
  });

  const handleSelect = useCallback(
    (action: MessageAction) => {
      void action.run();
      onClose();
    },
    [onClose],
  );

  const renderItem = (action: MessageAction) => (
    <MenuItem
      key={action.key}
      onClick={() => handleSelect(action)}
      sx={action.destructive ? { color: 'error.main' } : undefined}
    >
      <ListItemIcon sx={action.destructive ? { color: 'error.main' } : undefined}>
        {action.icon}
      </ListItemIcon>
      <ListItemText>{action.label}</ListItemText>
      {action.shortcut && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 3 }}>
          {action.shortcut}
        </Typography>
      )}
    </MenuItem>
  );

  const regularActions = actions.filter((a) => !a.destructive);
  const destructiveActions = actions.filter((a) => a.destructive);
  const showReactionRow = canReact && !!onEmojiSelect;

  return (
    <Menu
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition ?? undefined}
      open={open}
      onClose={onClose}
    >
      {/* Quick-reaction row. Each emoji is a real menu item (arrow-key
          navigable, valid inside role="menu"), laid out inline so they sit in
          one row; the divider below breaks the line. */}
      {showReactionRow &&
        QUICK_REACTIONS.map((emoji) => (
          <MenuItem
            key={emoji}
            aria-label={`React with ${emoji}`}
            data-quick-reaction
            onClick={() => {
              onEmojiSelect?.(emoji);
              onClose();
            }}
            sx={quickReactionSx}
          >
            {emoji}
          </MenuItem>
        ))}
      {showReactionRow && (
        <MenuItem
          aria-label="More reactions"
          data-quick-reaction
          onClick={() => {
            onAddReaction();
            onClose();
          }}
          sx={quickReactionSx}
        >
          <AddIcon fontSize="small" />
        </MenuItem>
      )}
      {showReactionRow && <Divider sx={{ my: 0.5 }} />}

      {regularActions.map(renderItem)}

      {destructiveActions.length > 0 && <Divider />}
      {destructiveActions.map(renderItem)}
    </Menu>
  );
};

export default MessageContextMenu;
