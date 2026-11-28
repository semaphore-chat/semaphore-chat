/**
 * A message's actions on the new shell's chat (PR 10c-2a): a kit Sheet opened by a long press, a right-click, the
 * context-menu key or Enter on the focused row. Six quick reactions on top, then the shared action model
 * (`data/chat/messageActionModel`, the old chat's menu and sheet): Reply, Edit, Pin or Unpin, Copy message content
 * and Delete, which asks first (the kit's destructive confirmation), See reactions when there are any (who
 * reacted, `ReactionPeopleSheet`), More reactions after the quick ones (the emoji picker, `ReactionPickerSheet`, once
 * this sheet has closed), and Reply in thread in a channel (it opens once this sheet has closed, focus back
 * on the row). Inside a thread there is no Reply and no Reply in thread (as the old thread panel). Who may do what is
 * the old chat's (`useMessagePermissions`; nothing on a message still sending or not sent).
 *
 * One host per conversation: the screen hands it the message whose actions were asked for. The row had focus when
 * it opened, so closing returns focus there (the overlay stack); Edit and Reply then move it to their field.
 *
 * On a device that is not touch-first (PR 10e) a right-click or the keyboard opens the same actions as a kit Menu
 * (`menu`): at the cursor, or beside the row (or the toolbar's More). One model serves both: the Menu has Add
 * reaction (the emoji picker) where the Sheet has its quick reactions, and dividers between the model's groups.
 */
import { messageCopyText } from '../../../../data/chat/messageActionModel';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { userControllerGetUserByIdOptions } from '../../../../api-client/@tanstack/react-query.gen';
import {
  Button,
  Icon,
  IconButton,
  ListRow,
  Menu,
  Sheet,
  Stack,
  useAnnounce,
  useConfirmDestructive,
  useToasts,
  type IconName,
  type MenuEntry,
} from '../../../../kit';
import { copyToClipboard } from '../../../../utils/clipboard';
import { getMessageActionModel, type MessageActionId } from '../../../../data/chat/messageActionModel';
import { useMessageActions } from '../../../../data/chat/useMessageActions';
import { findCachedChannel } from '../../../../hooks/useChannelMentionTarget';
import { useMessagePermissions } from '../../../../hooks/useMessagePermissions';
import type { Message } from '../../../../types/message.type';

/** The quick reactions, in order: thumbs up, heart, laughing, surprised, sad, party. */
export const QUICK_REACTIONS = [
  { emoji: '👍', name: 'thumbs up' },
  { emoji: '❤️', name: 'heart' },
  { emoji: '😂', name: 'laughing' },
  { emoji: '😮', name: 'surprised' },
  { emoji: '😢', name: 'sad' },
  { emoji: '🎉', name: 'party' },
] as const;

const ICON: Partial<Record<MessageActionId, IconName>> = {
  reply: 'Reply',
  'reply-in-thread': 'MessageSquare',
  edit: 'Pencil',
  'add-reaction': 'SmilePlus',
  pin: 'Pin',
  copy: 'Copy',
  delete: 'Trash2',
};

/** The new shell's names for the shared actions (sentence case). */
const LABEL: Partial<Record<MessageActionId, string>> = {
  reply: 'Reply',
  'reply-in-thread': 'Reply in thread',
  'add-reaction': 'Add reaction',
  edit: 'Edit message',
  copy: 'Copy message content',
  delete: 'Delete message',
};

/** Where a Menu opens: beside `anchor` (the row, or the toolbar's More), or at `point` (a right-click). */
export interface ActionsMenuPlacement {
  anchor: HTMLElement | null;
  point?: { x: number; y: number };
}

export interface MessageActionsSheetProps {
  /** The message whose actions are open, or null. */
  message: Message | null;
  me: string;
  communityId: string;
  /** Show the actions as a Menu here (not touch-first); undefined: the Sheet. */
  menu?: ActionsMenuPlacement;
  /** The actions are done with (the sheet closed, and a delete's question answered). */
  onDone: () => void;
  /** Quote reply; undefined in a thread (no Reply there). */
  onReply?: (message: Message) => void;
  /** Opens the message's thread; undefined inside a thread. */
  onReplyInThread?: (message: Message) => void;
  onEdit: (message: Message) => void;
  /** Who reacted: offered when the message has reactions. */
  onShowReactions: (message: Message) => void;
  /** The full emoji picker to react with: after the quick reactions. */
  onMoreReactions?: (message: Message) => void;
}

export function MessageActionsSheet({ message, ...rest }: MessageActionsSheetProps): JSX.Element | null {
  if (message === null) return null;
  return <ActionsFor key={message.id} message={message} {...rest} />;
}

/** One action as both views show it. `after`: it opens another layer, so it runs once this one has closed. */
interface ActionView {
  id: string;
  group: string;
  label: string;
  icon: IconName;
  destructive: boolean;
  after: boolean;
  run: () => void;
}

function ActionsFor({
  message,
  me,
  communityId,
  menu,
  onDone,
  onReply,
  onReplyInThread,
  onEdit,
  onShowReactions,
  onMoreReactions,
}: MessageActionsSheetProps & { message: Message }): JSX.Element {
  const queryClient = useQueryClient();
  const announce = useAnnounce();
  const toasts = useToasts();
  const [open, setOpen] = useState(true);
  const { data: author } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: message.authorId ?? '' } }),
    enabled: !!message.authorId && !message.webhook,
  });
  const authorName = message.webhook?.name ?? (author?.displayName || author?.username);
  const optimistic = message.sendStatus === 'pending' || message.sendStatus === 'failed';
  const permissions = useMessagePermissions({ message, currentUserId: me, communityId });
  const actions = useMessageActions(message, me);
  const isPinned = message.pinned === true;
  const canReact = permissions.canReact && !optimistic;

  const hasReplies = (message.replyCount ?? 0) > 0;
  const confirm = useConfirmDestructive({
    title: 'Delete this message?',
    description: hasReplies
      ? `This message has ${message.replyCount} thread ${message.replyCount === 1 ? 'reply' : 'replies'}. Deleting it will also delete all replies.`
      : 'It is removed for everyone. This cannot be undone.',
    confirmLabel: hasReplies ? 'Delete all' : 'Delete message',
    run: () => actions.deleteMessage(),
    errorMessage: () => "Couldn't delete the message. Try again.",
  });

  // "See reactions" opens its sheet once this one has closed (focus is back on the row by then, so it returns there).
  const [then, setThen] = useState<(() => void) | null>(null);
  // Done once the sheet is closed and no delete question is open or running.
  useEffect(() => {
    if (!open && confirm.phase === 'idle') {
      onDone();
      then?.();
    }
  }, [open, confirm.phase, onDone, then]);
  const hasReactions = message.reactions.some((r) => r.userIds.length > 0);

  const close = useCallback(() => setOpen(false), []);

  // Copy says whether it worked (a page served over plain http has no clipboard).
  const copy = async () => {
    try {
      await copyToClipboard(messageCopyText(message.spans, (id) => findCachedChannel(queryClient, id)?.name));
      announce('Message copied');
    } catch {
      toasts.show({ tone: 'danger', message: "Couldn't copy the message" });
    }
  };

  const model = getMessageActionModel({
    message,
    channelName: (id) => findCachedChannel(queryClient, id)?.name,
    canEdit: permissions.canEdit && !optimistic,
    canDelete: permissions.canDelete && !optimistic,
    canPin: permissions.canPin && !optimistic,
    // The Menu's Add reaction is the emoji picker; the Sheet has its quick reactions and More reactions instead.
    canReact: canReact && menu !== undefined && onMoreReactions !== undefined,
    canThread: onReplyInThread !== undefined && !optimistic,
    isPinned,
    handlers: {
      onEdit: () => onEdit(message),
      onDelete: () => confirm.request(),
      onPin: () => void actions.handlePin(),
      onUnpin: () => void actions.handleUnpin(),
      onReplyInThread: () => onReplyInThread?.(message),
      onQuoteReply: message.deletedAt || optimistic || onReply === undefined ? undefined : () => onReply(message),
      onAddReaction: () => onMoreReactions?.(message),
    },
  });
  const views: ActionView[] = model.map((action) => ({
    id: action.key,
    group: action.group,
    label: action.key === 'pin' ? (isPinned ? 'Unpin message' : 'Pin message') : (LABEL[action.key] ?? action.label),
    icon: action.key === 'pin' && isPinned ? 'PinOff' : (ICON[action.key] ?? 'Pin'),
    destructive: action.destructive === true,
    // The thread and the emoji picker open once this layer has closed and focus is back on the row (their opener).
    after: action.key === 'reply-in-thread' || action.key === 'add-reaction',
    run: action.key === 'copy' ? () => void copy() : () => void action.run(),
  }));
  if (hasReactions) {
    views.push({
      id: 'see-reactions',
      group: 'copy',
      label: 'See reactions',
      icon: 'Smile',
      destructive: false,
      after: true,
      run: () => onShowReactions(message),
    });
  }
  const choose = (view: ActionView) => {
    if (view.after) {
      setThen(() => view.run);
      close();
      return;
    }
    close();
    view.run();
  };

  const react = (emoji: string) => {
    void actions.handleReactionClick(emoji);
    close();
  };

  if (menu !== undefined) {
    const items: MenuEntry[] = [];
    views.forEach((view, i) => {
      // A divider between groups, and before a destructive action (as the old right-click menu).
      if (i > 0 && (view.group !== views[i - 1].group || view.destructive)) items.push({ id: `divider-${view.id}`, divider: true });
      items.push({ id: view.id, label: view.label, icon: view.icon, tone: view.destructive ? 'danger' : 'default', onSelect: () => choose(view) });
    });
    return (
      <>
        <Menu
          open={open}
          anchor={menu.anchor}
          point={menu.point}
          // The Menu calls this after an item's own `onSelect`, which has already closed it.
          onClose={close}
          label={authorName ? `Actions for ${authorName}'s message` : 'Message actions'}
          items={items}
        />
        {confirm.dialog}
      </>
    );
  }

  return (
    <>
      <Sheet open={open} onClose={close} title={authorName ? `Message from ${authorName}` : 'Message'}>
        <Stack gap="md">
          {canReact && (
            <Stack direction="row" gap="xs">
              {QUICK_REACTIONS.map(({ emoji, name }) => {
                const mine = message.reactions.some((r) => r.emoji === emoji && r.userIds.includes(me));
                return (
                  <Button key={emoji} variant="ghost" size="sm" aria-label={`React with ${name}`} aria-pressed={mine} onClick={() => react(emoji)}>
                    {emoji}
                  </Button>
                );
              })}
              {onMoreReactions !== undefined && (
                <IconButton
                  icon="SmilePlus"
                  variant="ghost"
                  label="More reactions"
                  onClick={() => {
                    setThen(() => () => onMoreReactions(message));
                    close();
                  }}
                />
              )}
            </Stack>
          )}
          <Stack gap="xs">
            {views.map((view) => (
              <ListRow
                key={view.id}
                primary={view.label}
                leading={<Icon name={view.icon} size="md" tone={view.destructive ? 'danger' : 'secondary'} />}
                onClick={() => choose(view)}
              />
            ))}
          </Stack>
        </Stack>
      </Sheet>
      {confirm.dialog}
    </>
  );
}
