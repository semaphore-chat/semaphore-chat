/**
 * MessageContextMenu
 *
 * Right-click context menu for messages (web and Electron).
 * Provides quick access to message actions: reply, react, pin, edit, delete, copy.
 */

import React, { useCallback } from 'react';
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import type { Message } from '../../types/message.type';
import { getMessageActions, type MessageAction } from './messageActions';
import { useQueryClient } from "@tanstack/react-query";
import { findCachedChannel } from "../../hooks/useChannelMentionTarget";

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
    </MenuItem>
  );

  const replyActions = actions.filter((a) => a.group === 'reply');
  const reactionActions = actions.filter((a) => a.group === 'reaction');
  const moderationActions = actions.filter((a) => a.group === 'moderation');
  const copyActions = actions.filter((a) => a.group === 'copy');

  const hasReplyItems = replyActions.length > 0;
  const hasMiddleItems = moderationActions.length > 0;

  return (
    <Menu
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition ?? undefined}
      open={open}
      onClose={onClose}
    >
      {replyActions.map(renderItem)}

      {/* Divider between reply actions and reaction */}
      {hasReplyItems && <Divider />}

      {reactionActions.map(renderItem)}

      {/* Divider between reaction and moderation/edit actions */}
      {reactionActions.length > 0 && hasMiddleItems && <Divider />}

      {moderationActions.map(renderItem)}

      {/* Divider before copy */}
      <Divider />

      {copyActions.map(renderItem)}
    </Menu>
  );
};

export default MessageContextMenu;
