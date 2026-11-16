/**
 * One message of the new shell's chat: the separators above it and a kit `MessageRow` with its words, quote,
 * files, reactions and replies count. `renderRow` unpacks the list core's context into the scalar props here, so
 * the `memo` skips every row whose message and place did not change (a focus move re-renders two rows).
 *
 * What the screen knows around every row (the reader, where links lead, the community's emoji, the visible
 * channels) comes from `ChatRowContext`, one value for the whole list.
 */
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AttachmentTile,
  Composer,
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
  type OpenActionsVia,
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
import { useIsEditing, type EditingStore } from '../../../../data/chat/editingStore';
import { useOptimisticMessageRetry } from '../../../../hooks/useOptimisticSendMessage';
import { usePendingUpload } from '../../../../hooks/usePendingUpload';
import { removeAttachment, retryAttachment, startAttachmentUploads } from '../../../../utils/attachmentSend';
import { formatFileSize } from '../../../../utils/format';
import { isOptimisticMessageId } from '../../../../utils/messageCacheUpdaters';
import type { PendingFile } from '../../../../utils/pendingUploadStore';
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
  /** The row asked for its actions (the row has focus by then). */
  openActions(message: Message, via: OpenActionsVia): void;
  /** Which message is being edited in place. */
  editing: EditingStore;
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

/** A failed send's Retry and Delete (`useOptimisticMessageRetry`), for the row that shows them. */
interface FailedControls {
  onRetry: () => void;
  onDelete: () => void;
  retrying: boolean;
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

/** What an uploading file's tile says under its name (as the old chat's `PendingAttachments`). */
function uploadDetail(file: PendingFile, sendFailed: boolean): string {
  switch (file.status) {
    case 'waiting':
      return sendFailed ? "Not uploaded: the message wasn't sent" : 'Waiting to upload…';
    case 'attaching':
      return 'Finishing…';
    default:
      if (file.progress >= 1) return 'Finishing…';
      return `${formatFileSize(file.size * file.progress)} of ${formatFileSize(file.size)}`;
  }
}

/** The files the reader's own message is still uploading: progress, and Retry or Remove when one failed. */
function Uploads({ message }: { message: Message }): JSX.Element | null {
  const entry = usePendingUpload(message);
  const isServerMessage = !message.sendStatus && !isOptimisticMessageId(message.id);
  // The message became real without its uploads hearing about it (a late echo): start them now (as the old chat).
  useEffect(() => {
    if (entry && !entry.messageId && isServerMessage) startAttachmentUploads(entry.clientId, message.id);
  }, [entry, isServerMessage, message.id]);
  if (!entry) return null;
  const attached = new Set((message.attachments ?? []).map((a) => a.id));
  const files = entry.files.filter((f) => f.status !== 'done' && !(f.fileId && attached.has(f.fileId)));
  if (files.length === 0) return null;
  const sendFailed = message.sendStatus === 'failed';
  return (
    <>
      {files.map((file) => (
        <AttachmentTile
          key={file.localId}
          kind="file"
          name={file.name}
          detail={uploadDetail(file, sendFailed)}
          src={file.previewUrl && file.mimeType.startsWith('image/') ? file.previewUrl : undefined}
          progress={file.status === 'failed' ? undefined : file.status === 'attaching' ? 100 : Math.round(file.progress * 100)}
          error={file.status === 'failed' ? (file.error ? `Upload failed: ${file.error}` : 'Upload failed') : undefined}
          onRetry={file.status === 'failed' ? () => void retryAttachment(entry.clientId, file.localId) : undefined}
          onRemove={() => void removeAttachment(entry.clientId, file.localId)}
        />
      ))}
    </>
  );
}

/**
 * The message's words, edited in place (the old chat's phone behaviour): the kit composer inline, in save mode,
 * on the shared edit state. Enter saves, Shift+Enter starts a line, Escape (or Cancel) leaves it unchanged. When
 * the edit ends, focus goes back to the row.
 */
function InlineEdit({ message, row }: { message: Message; row: { current: HTMLDivElement | null } }): JSX.Element {
  const shared = useShared();
  const { isEditing, editText, setEditText, handleEditClick, handleEditSave, handleEditCancel } = useMessageActions(message, shared.me);
  const field = useRef<HTMLTextAreaElement>(null);
  const [started, setStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    handleEditClick();
    setStarted(true);
    // The field takes focus once the actions sheet has given it back to the row.
    const frame = requestAnimationFrame(() => {
      const input = field.current;
      if (input === null) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the edit opens
  }, []);
  const { editing } = shared;
  useEffect(() => {
    if (started && !isEditing) {
      editing.stop(message.id);
      requestAnimationFrame(() => row.current?.focus({ preventScroll: true }));
    }
  }, [started, isEditing, editing, message.id, row]);
  return (
    <Composer
      ref={field}
      inline
      mode="save"
      label="Edit message"
      value={editText}
      onChange={setEditText}
      sending={saving}
      canSend={editText.trim() !== '' || message.attachments.length > 0}
      onSubmit={() => {
        setSaving(true);
        void handleEditSave().finally(() => setSaving(false));
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          handleEditCancel();
        }
      }}
      banner={{ kind: 'editing', title: 'Editing message', detail: 'Escape to cancel, Enter to save', cancelLabel: 'Cancel editing', onCancel: handleEditCancel }}
    />
  );
}

function repliesText(count: number): string {
  return count === 1 ? '1 reply' : `${count} replies`;
}

function FailedChatRow(props: ChatRowProps): JSX.Element {
  const { retry, remove } = useOptimisticMessageRetry(props.message);
  const [retrying, setRetrying] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onRetry = useCallback(() => {
    setRetrying(true);
    void retry().finally(() => {
      if (mounted.current) setRetrying(false);
    });
  }, [retry]);
  return <ChatRowBody {...props} failed={{ onRetry, onDelete: remove, retrying }} />;
}

function ChatRowView(props: ChatRowProps): JSX.Element {
  return props.message.sendStatus === 'failed' ? <FailedChatRow {...props} /> : <ChatRowBody {...props} />;
}

function ChatRowBody({
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
  failed,
}: ChatRowProps & { failed?: FailedControls }): JSX.Element {
  const shared = useShared();
  const rowRef = useRef<HTMLDivElement>(null);
  const isEditing = useIsEditing(shared.editing, message.id);
  const pendingUpload = usePendingUpload(message);
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
  const { openActions } = shared;
  const onOpenActions = useCallback(
    ({ via }: { via: OpenActionsVia }) => {
      // The row holds focus while its actions are open, so closing them brings focus back here.
      rowRef.current?.focus({ preventScroll: true });
      openActions(message, via);
    },
    [openActions, message],
  );

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
        body={
          isEditing ? (
            <InlineEdit message={message} row={rowRef} />
          ) : segments.length > 0 ? (
            <MessageText segments={segments} onMention={onMention} />
          ) : undefined
        }
        attachments={
          files.length > 0 || pendingUpload !== undefined ? (
            <Stack gap="sm" align="start">
              {files.map((file) => (
                <Attachment key={file.id} file={file} />
              ))}
              <Uploads message={message} />
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
        onOpenActions={isEditing ? undefined : onOpenActions}
        onRetry={failed?.onRetry}
        onDelete={failed?.onDelete}
        retrying={failed?.retrying}
        focus={focus}
        ref={rowRef}
      />
    </>
  );
}

export const ChatRow = memo(ChatRowView);
