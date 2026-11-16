/**
 * A message's actions on the new shell's chat (PR 10c-2a): a kit Sheet opened by a long press, a right-click, the
 * context-menu key or Enter on the focused row. Six quick reactions on top, then the shared action model
 * (`data/chat/messageActionModel`, the old chat's menu and sheet): Reply, Edit, Pin or Unpin, Copy message content
 * and Delete, which asks first (the kit's destructive confirmation). Reply in thread is not offered (no threads in
 * the new shell yet). Who may do what is the old chat's (`useMessagePermissions`; nothing on a message still
 * sending or not sent).
 *
 * One host per conversation: the screen hands it the message whose actions were asked for. The row had focus when
 * it opened, so closing returns focus there (the overlay stack); Edit and Reply then move it to their field.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { userControllerGetUserByIdOptions } from '../../../../api-client/@tanstack/react-query.gen';
import { Button, Icon, ListRow, Sheet, Stack, useAnnounce, useConfirmDestructive, useToasts, type IconName } from '../../../../kit';
import { copyToClipboard } from '../../../../utils/clipboard';
import { spansToText } from '../../../../utils/mentionParser';
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
  edit: 'Pencil',
  pin: 'Pin',
  copy: 'Copy',
  delete: 'Trash2',
};

/** The new shell's names for the shared actions (sentence case). */
const LABEL: Partial<Record<MessageActionId, string>> = {
  reply: 'Reply',
  edit: 'Edit message',
  copy: 'Copy message content',
  delete: 'Delete message',
};

export interface MessageActionsSheetProps {
  /** The message whose actions are open, or null. */
  message: Message | null;
  me: string;
  communityId: string;
  /** The actions are done with (the sheet closed, and a delete's question answered). */
  onDone: () => void;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
}

export function MessageActionsSheet({ message, ...rest }: MessageActionsSheetProps): JSX.Element | null {
  if (message === null) return null;
  return <ActionsFor key={message.id} message={message} {...rest} />;
}

function ActionsFor({
  message,
  me,
  communityId,
  onDone,
  onReply,
  onEdit,
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

  // Done once the sheet is closed and no delete question is open or running.
  useEffect(() => {
    if (!open && confirm.phase === 'idle') onDone();
  }, [open, confirm.phase, onDone]);

  const close = useCallback(() => setOpen(false), []);
  const model = getMessageActionModel({
    message,
    channelName: (id) => findCachedChannel(queryClient, id)?.name,
    canEdit: permissions.canEdit && !optimistic,
    canDelete: permissions.canDelete && !optimistic,
    canPin: permissions.canPin && !optimistic,
    canReact,
    canThread: false,
    isPinned,
    handlers: {
      onEdit: () => onEdit(message),
      onDelete: () => confirm.request(),
      onPin: () => void actions.handlePin(),
      onUnpin: () => void actions.handleUnpin(),
      onReplyInThread: () => undefined,
      onQuoteReply: message.deletedAt || optimistic ? undefined : () => onReply(message),
      onAddReaction: () => undefined,
    },
  }).filter((action) => action.group !== 'reaction');

  // Copy says whether it worked (a page served over plain http has no clipboard).
  const copy = async () => {
    try {
      await copyToClipboard(spansToText(message.spans, (id) => findCachedChannel(queryClient, id)?.name));
      announce('Message copied');
    } catch {
      toasts.show({ tone: 'danger', message: "Couldn't copy the message" });
    }
  };

  const react = (emoji: string) => {
    void actions.handleReactionClick(emoji);
    close();
  };

  return (
    <>
      <Sheet open={open} onClose={close} title={authorName ? `Message from ${authorName}` : 'Message'}>
        <Stack gap="md">
          {canReact && (
            <Stack direction="row" gap="xs">
              {QUICK_REACTIONS.map(({ emoji, name }) => {
                const mine = message.reactions.some((r) => r.emoji === emoji && r.userIds.includes(me));
                return (
                  <Button key={emoji} variant="ghost" aria-label={`React with ${name}`} aria-pressed={mine} onClick={() => react(emoji)}>
                    {emoji}
                  </Button>
                );
              })}
            </Stack>
          )}
          <Stack gap="xs">
            {model.map((action) => (
              <ListRow
                key={action.key}
                primary={action.key === 'pin' ? (isPinned ? 'Unpin message' : 'Pin message') : (LABEL[action.key] ?? action.label)}
                leading={<Icon name={ICON[action.key] ?? 'Pin'} size="md" tone={action.destructive ? 'danger' : 'secondary'} />}
                onClick={() => {
                  close();
                  if (action.key === 'copy') void copy();
                  else void action.run();
                }}
              />
            ))}
          </Stack>
        </Stack>
      </Sheet>
      {confirm.dialog}
    </>
  );
}
