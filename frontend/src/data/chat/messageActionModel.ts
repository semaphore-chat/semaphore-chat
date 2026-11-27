/**
 * messageActionModel
 *
 * Data-driven model of the actions available on a message: ids, labels,
 * order and the rules for which are offered, with no icons (each shell picks
 * its own). The classic desktop right-click menu (MessageContextMenu) and
 * mobile bottom sheet (MessageActionsSheet) read it through
 * components/Message/messageActions, which adds the MUI icons, so both stay
 * in lock-step.
 */

import { stripUnpairedBidi } from '../../utils/bidi';
import type { Message } from '../../types/message.type';
import { spansToText } from '../../utils/mentionParser';
import { copyToClipboard } from '../../utils/clipboard';

/** What Copy puts on the clipboard: the message's text, without unpaired bidi controls. */
export function messageCopyText(
  spans: Message['spans'],
  channelName?: (channelId: string) => string | undefined,
): string {
  return stripUnpairedBidi(spansToText(spans, channelName));
}

/** Logical grouping used to lay out dividers between sections. */
export type MessageActionGroup = 'reply' | 'reaction' | 'moderation' | 'copy';

/** The stable id of each action. */
export type MessageActionId =
  | 'reply'
  | 'reply-in-thread'
  | 'add-reaction'
  | 'edit'
  | 'pin'
  | 'copy'
  | 'delete';

export interface MessageActionModelItem {
  /** Stable identifier for keys/tests. */
  key: MessageActionId;
  label: string;
  group: MessageActionGroup;
  /**
   * Keyboard shortcut hint shown on the right of the desktop menu. Set it
   * only for an action that really has that shortcut; none do today.
   */
  shortcut?: string;
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
 * permissions and handlers. Order: Reply, Thread, React, Edit, Pin, Copy,
 * then Delete last (destructive).
 */
export function getMessageActionModel(config: MessageActionConfig): MessageActionModelItem[] {
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

  const actions: MessageActionModelItem[] = [];

  // Reply actions
  if (handlers.onQuoteReply) {
    const onQuoteReply = handlers.onQuoteReply;
    actions.push({
      key: 'reply',
      label: 'Reply',
      group: 'reply',
      run: () => onQuoteReply(),
    });
  }
  if (canThread) {
    actions.push({
      key: 'reply-in-thread',
      label: 'Reply in Thread',
      group: 'reply',
      run: () => handlers.onReplyInThread(),
    });
  }

  // Reaction
  if (canReact) {
    actions.push({
      key: 'add-reaction',
      label: 'Add Reaction',
      group: 'reaction',
      run: () => handlers.onAddReaction(),
    });
  }

  if (canEdit) {
    actions.push({
      key: 'edit',
      label: 'Edit Message',
      group: 'moderation',
      run: () => handlers.onEdit(),
    });
  }
  if (canPin) {
    actions.push({
      key: 'pin',
      label: isPinned ? 'Unpin Message' : 'Pin Message',
      group: 'moderation',
      run: () => (isPinned ? handlers.onUnpin() : handlers.onPin()),
    });
  }
  // Copy — always available
  actions.push({
    key: 'copy',
    label: 'Copy Message Content',
    group: 'copy',
    run: async () => {
      const text = messageCopyText(message.spans, config.channelName);
      try {
        await copyToClipboard(text);
      } catch {
        // Clipboard write can fail in non-secure contexts; fail silently
      }
    },
  });

  if (canDelete) {
    actions.push({
      key: 'delete',
      label: 'Delete Message',
      group: 'moderation',
      destructive: true,
      run: () => handlers.onDelete(),
    });
  }


  return actions;
}
