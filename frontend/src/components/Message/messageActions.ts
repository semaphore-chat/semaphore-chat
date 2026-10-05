/**
 * messageActions
 *
 * Data-driven model of the actions available on a message. Shared by the
 * desktop right-click menu (MessageContextMenu) and the mobile bottom sheet
 * (MessageActionsSheet) so both stay in lock-step.
 */

import React from 'react';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import AddReactionIcon from '@mui/icons-material/AddReaction';
import PushPinIcon from '@mui/icons-material/PushPin';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { Message } from '../../types/message.type';
import { spansToText } from '../../utils/mentionParser';
import { copyToClipboard } from '../../utils/clipboard';

/** Logical grouping used to lay out dividers between sections. */
export type MessageActionGroup = 'reply' | 'reaction' | 'moderation' | 'copy';

export interface MessageAction {
  /** Stable identifier for keys/tests. */
  key: string;
  label: string;
  icon: React.ReactNode;
  group: MessageActionGroup;
  /** Destructive actions render in the error color. */
  destructive?: boolean;
  /** Performs the action. Does NOT close the surrounding menu/sheet. */
  run: () => void | Promise<void>;
}

export interface MessageActionHandlers {
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onReplyInThread: () => void;
  onQuoteReply?: () => void;
  onAddReaction: () => void;
}

export interface MessageActionConfig {
  message: Message;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  canReact: boolean;
  canThread: boolean;
  isPinned: boolean;
  handlers: MessageActionHandlers;
  /** Names #channel mentions when copying (spans store no channel name). */
  channelName?: (channelId: string) => string | undefined;
}

/**
 * Build the ordered list of actions for a message given the caller's
 * permissions and handlers. Order and inclusion mirror the original
 * MessageContextMenu exactly.
 */
export function getMessageActions(config: MessageActionConfig): MessageAction[] {
  const {
    message,
    canEdit,
    canDelete,
    canPin,
    canReact,
    canThread,
    isPinned,
    handlers,
  } = config;

  const actions: MessageAction[] = [];

  // Reply actions
  if (handlers.onQuoteReply) {
    const onQuoteReply = handlers.onQuoteReply;
    actions.push({
      key: 'reply',
      label: 'Reply',
      icon: React.createElement(FormatQuoteIcon, { fontSize: 'small' }),
      group: 'reply',
      run: () => onQuoteReply(),
    });
  }
  if (canThread) {
    actions.push({
      key: 'reply-in-thread',
      label: 'Reply in Thread',
      icon: React.createElement(ChatBubbleOutlineIcon, { fontSize: 'small' }),
      group: 'reply',
      run: () => handlers.onReplyInThread(),
    });
  }

  // Reaction
  if (canReact) {
    actions.push({
      key: 'add-reaction',
      label: 'Add Reaction',
      icon: React.createElement(AddReactionIcon, { fontSize: 'small' }),
      group: 'reaction',
      run: () => handlers.onAddReaction(),
    });
  }

  // Moderation / edit
  if (canPin) {
    actions.push({
      key: 'pin',
      label: isPinned ? 'Unpin Message' : 'Pin Message',
      icon: React.createElement(PushPinIcon, { fontSize: 'small' }),
      group: 'moderation',
      run: () => (isPinned ? handlers.onUnpin() : handlers.onPin()),
    });
  }
  if (canEdit) {
    actions.push({
      key: 'edit',
      label: 'Edit Message',
      icon: React.createElement(EditIcon, { fontSize: 'small' }),
      group: 'moderation',
      run: () => handlers.onEdit(),
    });
  }
  if (canDelete) {
    actions.push({
      key: 'delete',
      label: 'Delete Message',
      icon: React.createElement(DeleteIcon, { fontSize: 'small' }),
      group: 'moderation',
      destructive: true,
      run: () => handlers.onDelete(),
    });
  }

  // Copy — always available
  actions.push({
    key: 'copy',
    label: 'Copy Message Content',
    icon: React.createElement(ContentCopyIcon, { fontSize: 'small' }),
    group: 'copy',
    run: async () => {
      const text = spansToText(message.spans, config.channelName);
      try {
        await copyToClipboard(text);
      } catch {
        // Clipboard write can fail in non-secure contexts; fail silently
      }
    },
  });

  return actions;
}
