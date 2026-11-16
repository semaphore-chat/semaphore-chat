/**
 * messageActions
 *
 * The message action model (data/chat/messageActionModel) with the classic
 * MUI icons. Shared by the desktop right-click menu (MessageContextMenu) and
 * the mobile bottom sheet (MessageActionsSheet) so both stay in lock-step.
 */

import React from 'react';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import AddReactionIcon from '@mui/icons-material/AddReaction';
import PushPinIcon from '@mui/icons-material/PushPin';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  getMessageActionModel,
  type MessageActionConfig,
  type MessageActionId,
  type MessageActionModelItem,
} from '../../data/chat/messageActionModel';

export type {
  MessageActionGroup,
  MessageActionHandlers,
  MessageActionConfig,
} from '../../data/chat/messageActionModel';

export interface MessageAction extends MessageActionModelItem {
  icon: React.ReactNode;
}

const ICONS: Record<MessageActionId, React.ElementType> = {
  reply: FormatQuoteIcon,
  'reply-in-thread': ChatBubbleOutlineIcon,
  'add-reaction': AddReactionIcon,
  edit: EditIcon,
  pin: PushPinIcon,
  copy: ContentCopyIcon,
  delete: DeleteIcon,
};

/**
 * Build the ordered list of actions for a message given the caller's
 * permissions and handlers (see getMessageActionModel), each with its icon.
 */
export function getMessageActions(config: MessageActionConfig): MessageAction[] {
  return getMessageActionModel(config).map((action) => ({
    ...action,
    icon: React.createElement(ICONS[action.key], { fontSize: 'small' }),
  }));
}
