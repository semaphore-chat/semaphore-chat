/**
 * MessageActionsSheet
 *
 * Mobile bottom-sheet equivalent of MessageContextMenu. Shows a quick-reaction
 * row on top and the shared, data-driven message action list below as large,
 * touch-friendly rows.
 */

import React, { useCallback } from 'react';
import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { MobileSheet } from '../Mobile/common/MobileSheet';
import { TOUCH_TARGETS } from '../../utils/breakpoints';
import { getMessageActions, type MessageAction } from './messageActions';
import { EMOJI_CATEGORIES } from './EmojiPicker';
import type { MessageContextMenuProps } from './MessageContextMenu';

/** Common emoji for the quick-reaction row (first row of "Frequently Used"). */
export const QUICK_REACTIONS = EMOJI_CATEGORIES['Frequently Used'].slice(0, 8);

export interface MessageActionsSheetProps extends MessageContextMenuProps {
  /** Add a specific reaction from the quick-reaction row. */
  onEmojiSelect: (emoji: string) => void;
}

const MessageActionsSheet: React.FC<MessageActionsSheetProps> = ({
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
  const actions = getMessageActions({
    message,
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

  // The quick-reaction row + "+" cover reactions, so drop the redundant
  // "Add Reaction" list row.
  const listActions = actions.filter((a) => a.group !== 'reaction');

  const handleSelect = useCallback(
    (action: MessageAction) => {
      void action.run();
      onClose();
    },
    [onClose],
  );

  const handleQuickReaction = useCallback(
    (emoji: string) => {
      onEmojiSelect(emoji);
      onClose();
    },
    [onEmojiSelect, onClose],
  );

  const handleOpenPicker = useCallback(() => {
    onAddReaction();
    onClose();
  }, [onAddReaction, onClose]);

  return (
    <MobileSheet open={open} onClose={onClose} maxHeight="70vh" showCloseButton={false}>
      {canReact && (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              flexWrap: 'wrap',
              pb: 1.5,
            }}
          >
            {QUICK_REACTIONS.map((emoji) => (
              <IconButton
                key={emoji}
                aria-label={`React with ${emoji}`}
                onClick={() => handleQuickReaction(emoji)}
                sx={{
                  minWidth: TOUCH_TARGETS.MINIMUM,
                  minHeight: TOUCH_TARGETS.MINIMUM,
                  fontSize: 'icon.2xl',
                }}
              >
                {emoji}
              </IconButton>
            ))}
            <IconButton
              aria-label="More reactions"
              onClick={handleOpenPicker}
              sx={{
                minWidth: TOUCH_TARGETS.MINIMUM,
                minHeight: TOUCH_TARGETS.MINIMUM,
              }}
            >
              <AddIcon />
            </IconButton>
          </Box>
          <Divider />
        </>
      )}

      <List disablePadding>
        {listActions.map((action) => (
          <ListItemButton
            key={action.key}
            onClick={() => handleSelect(action)}
            sx={{
              minHeight: TOUCH_TARGETS.RECOMMENDED,
              borderRadius: 1,
              color: action.destructive ? 'error.main' : undefined,
            }}
          >
            <ListItemIcon
              sx={{ color: action.destructive ? 'error.main' : undefined }}
            >
              {action.icon}
            </ListItemIcon>
            <ListItemText
              primaryTypographyProps={{ sx: { fontSize: 'scale.lg' } }}
            >
              {action.label}
            </ListItemText>
          </ListItemButton>
        ))}
      </List>
    </MobileSheet>
  );
};

export default MessageActionsSheet;
