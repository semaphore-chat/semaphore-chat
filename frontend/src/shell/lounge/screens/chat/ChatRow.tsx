/**
 * One message of the new shell's chat: the separators above it and a kit `MessageRow` with its words, quote,
 * files, reactions and replies count. `renderRow` unpacks the list core's context into the scalar props here, so
 * the `memo` skips every row whose message and place did not change (a focus move re-renders two rows).
 *
 * What the screen knows around every row (the reader, where links lead, the community's emoji, the visible
 * channels) comes from `ChatRowContext`, one value for the whole list.
 */
import { createContext, memo, useCallback, useContext, useMemo, type JSX, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AttachmentTile,
  ListSeparator,
  MessageQuote,
  MessageRow,
  MessageText,
  ReactionChip,
  Stack,
  Text,
  useAnnounce,
  type MentionSegment,
  type MessageRowFocus,
} from '../../../../kit';
import { userControllerGetUserByIdOptions } from '../../../../api-client/@tanstack/react-query.gen';
import { useAuthenticatedFile, useAuthenticatedImage } from '../../../../hooks/useAuthenticatedFile';
import { useMessagePermissions } from '../../../../hooks/useMessagePermissions';
import { useMessageActions } from '../../../../data/chat/useMessageActions';
import { toSegments, type ToSegmentsOptions } from '../../../../data/chat/toSegments';
import {
  toAttachmentViews,
  toQuoteView,
  toReactionViews,
  toRowView,
  type AttachmentView,
} from '../../../../data/chat/messageRowModel';
import { useAttachmentBusy, type AttachmentOpener } from '../../../../data/chat/useAttachmentOpener';
import type { Message } from '../../../../types/message.type';
import { formatDaySeparator } from '../../../../utils/messageTime';

/** What every row of one list shares. */
export interface ChatRowShared {
  me: string;
  communityId: string;
  /** The segments' lookups and links (`toSegments`). */
  segments: Omit<ToSegmentsOptions, 'me'>;
  /** Shows a message of this chat (a reply's original): the chat's path with `?highlight=`. */
  showMessage(messageId: string): void;
  /** Follows a channel mention (an app path). */
  openPath(path: string): void;
  openProfile?: (userId: string) => void;
  opener: AttachmentOpener;
}

export const ChatRowContext = createContext<ChatRowShared | null>(null);

function useShared(): ChatRowShared {
  const shared = useContext(ChatRowContext);
  if (shared === null) throw new Error('ChatRow needs a ChatRowContext');
  return shared;
}

/** The unread separator's tag. */
export const UNREAD_LABEL = 'New';

export interface ChatRowProps {
  message: Message;
  index: number;
  grouped: boolean;
  dayShownAbove: boolean;
  showDaySeparator: boolean;
  showUnreadDivider: boolean;
  isHighlighted: boolean;
  tabStop: boolean;
  onRovingKeyDown: (event: KeyboardEvent<HTMLDivElement>, index: number) => void;
  onRovingFocus: (index: number) => void;
}

function useUserName(userId: string | null | undefined): { name?: string; avatarFileId?: string | null } {
  const { data } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: userId ?? '' } }),
    enabled: !!userId,
  });
  return { name: data?.displayName || data?.username || undefined, avatarFileId: data?.avatarUrl ?? null };
}

function Quote({ replyTo }: { replyTo: NonNullable<Message['replyTo']> }): JSX.Element {
  const shared = useShared();
  const quote = toQuoteView(replyTo)!;
  const { name } = useUserName(quote.deleted ? null : quote.authorId);
  return (
    <MessageQuote
      author={name ?? quote.authorId ?? 'Unknown'}
      line={quote.line}
      deleted={quote.deleted}
      onOpen={() => shared.showMessage(quote.id)}
    />
  );
}

function Attachment({ file }: { file: AttachmentView }): JSX.Element {
  const { opener } = useShared();
  const busy = useAttachmentBusy(opener, file.id);
  // Images show their preview (the thumbnail, falling back to the file); other files load only when opened.
  const { blobUrl } = useAuthenticatedFile(file.kind === 'image' ? file.id : null, { fetchThumbnail: true });
  return (
    <AttachmentTile
      kind={file.kind}
      name={file.name}
      detail={file.detail}
      src={blobUrl ?? undefined}
      width={file.width}
      height={file.height}
      busy={busy}
      onOpen={() => opener.open({ id: file.id, name: file.name, mimeType: file.mimeType })}
    />
  );
}

function Reactions({ message }: { message: Message }): JSX.Element | null {
  const shared = useShared();
  const announce = useAnnounce();
  const { canReact } = useMessagePermissions({ message, currentUserId: shared.me, communityId: shared.communityId });
  const { handleReactionClick } = useMessageActions(message, shared.me);
  const reactions = toReactionViews(message.reactions, shared.me, shared.segments);
  if (reactions.length === 0) return null;
  return (
    <>
      {reactions.map((reaction) => (
        <ReactionChip
          key={reaction.key}
          emoji={reaction.emoji}
          src={reaction.src}
          label={reaction.label}
          count={reaction.count}
          mine={reaction.mine}
          aria-disabled={!canReact}
          onUnavailablePress={() => announce("You can't react in this channel")}
          onToggle={() => void handleReactionClick(reaction.key)}
        />
      ))}
    </>
  );
}

function repliesText(count: number): string {
  return count === 1 ? '1 reply' : `${count} replies`;
}

function ChatRowView({
  message,
  index,
  grouped,
  dayShownAbove,
  showDaySeparator,
  showUnreadDivider,
  isHighlighted,
  tabStop,
  onRovingKeyDown,
  onRovingFocus,
}: ChatRowProps): JSX.Element {
  const shared = useShared();
  const isWebhook = !!message.webhook;
  const author = useUserName(isWebhook ? null : message.authorId);
  const { blobUrl: avatar } = useAuthenticatedImage(isWebhook ? null : author.avatarFileId);
  const view = toRowView(message, { author, me: shared.me, dayShownAbove });
  const segments = useMemo(
    () => toSegments(message.spans, { ...shared.segments, me: shared.me }),
    [message.spans, shared.segments, shared.me],
  );
  const { openProfile, openPath } = shared;
  const onMention = useCallback(
    (mention: MentionSegment) => {
      if (mention.kind === 'user' && mention.id) openProfile?.(mention.id);
      else if (mention.href) openPath(mention.href.replace(/^#/, ''));
    },
    [openProfile, openPath],
  );
  const focus = useMemo<MessageRowFocus>(
    () => ({
      tabStop,
      onKeyDown: (event) => onRovingKeyDown(event as KeyboardEvent<HTMLDivElement>, index),
      onFocus: () => onRovingFocus(index),
    }),
    [tabStop, onRovingKeyDown, onRovingFocus, index],
  );
  const files = toAttachmentViews(message.attachments);
  const authorId = message.authorId;

  return (
    <>
      {showDaySeparator && <ListSeparator variant="day" label={formatDaySeparator(message.sentAt)} />}
      {showUnreadDivider && <ListSeparator variant="unread" label={UNREAD_LABEL} />}
      <MessageRow
        author={view.author}
        avatarSrc={view.webhookAvatar ?? avatar ?? undefined}
        time={view.time}
        dateTime={view.dateTime}
        timeLabel={view.timeLabel}
        continued={grouped}
        mentioned={view.mentioned}
        highlighted={isHighlighted}
        state={view.state}
        failedReason={view.failedReason}
        edited={view.edited}
        pinned={view.pinned}
        quote={message.replyTo ? <Quote replyTo={message.replyTo} /> : undefined}
        body={segments.length > 0 ? <MessageText segments={segments} onMention={onMention} /> : undefined}
        attachments={
          files.length > 0 ? (
            <Stack gap="sm" align="start">
              {files.map((file) => (
                <Attachment key={file.id} file={file} />
              ))}
            </Stack>
          ) : undefined
        }
        reactions={!view.optimistic && message.reactions.length > 0 ? <Reactions message={message} /> : undefined}
        footer={
          message.replyCount > 0 ? (
            // Threads are not in the new shell yet (owner default): the count, as plain text.
            <Text variant="small" tone="secondary">
              {repliesText(message.replyCount)}
            </Text>
          ) : undefined
        }
        onOpenAuthor={view.hasProfile && openProfile && authorId ? () => openProfile(authorId) : undefined}
        focus={focus}
      />
    </>
  );
}

export const ChatRow = memo(ChatRowView);
