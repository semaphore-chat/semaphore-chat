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
  Button,
  Composer,
  Icon,
  LinkCard,
  ListSeparator,
  MessageQuote,
  MessageRow,
  MessageText,
  ReactionChip,
  Stack,
  personColour,
  safeHref,
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
  sendFailureReason,
  toAttachmentViews,
  toLinkCards,
  toQuoteView,
  toReactionViews,
  toRowView,
  type AttachmentView,
} from '../../../../data/chat/messageRowModel';
import { getMessageLoneGifUrl } from '../../../../data/chat/messageUtils';
import { useLoadRemoteContent } from '../../../../hooks/useLoadRemoteContent';
import { useChannelPermissions } from '../../../../hooks/useChannelPermissions';
import { useVideoUrl } from '../../../../hooks/useVideoUrl';
import { useFileCache } from '../../../../contexts/AvatarCacheContext';
import { attachmentAction, useAttachmentBusy, viewableImages, type AttachmentOpener } from '../../../../data/chat/useAttachmentOpener';
import { useIsEditing, type EditingStore } from '../../../../data/chat/editingStore';
import { usePendingUpload } from '../../../../hooks/usePendingUpload';
import { removeAttachment, retryAttachment, startAttachmentUploads } from '../../../../utils/attachmentSend';
import { formatFileSize } from '../../../../utils/format';
import { isOptimisticMessageId } from '../../../../utils/messageCacheUpdaters';
import type { PendingFile } from '../../../../utils/pendingUploadStore';
import type { Message } from '../../../../types/message.type';
import { formatDaySeparator } from '../../../../utils/messageTime';
import { createBoundedSet } from './boundedSet';

/** What every row of one list shares. */
export interface ChatRowShared {
  me: string;
  communityId: string;
  /** The channel is known to be a text channel: reactions may be toggled (otherwise they are read-only). */
  writable: boolean;
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
  /** A picture of the message was pressed: the full-size viewer, at that picture. */
  openViewer(message: Message, fileId: string): void;
  /** Who reacted to the message (a reaction's chip asked: that reaction first); focus returns to `returnTo`. */
  showReactions(message: Message, reactionKey?: string, returnTo?: HTMLElement | null): void;
  /** Which message is being edited in place. */
  editing: EditingStore;
  /** Sends a failed message again (the same row); settles on the server's answer. */
  retrySend(message: Message): Promise<void>;
  /** Drops a failed message (it was never sent). */
  removeFailed(message: Message): void;
  /**
   * Opens the message's thread; `opener` is where focus goes back when it closes. Undefined inside a thread (its
   * parent's count is the separator under it, not a button).
   */
  openThread?: (message: Message, opener: HTMLElement | null) => void;
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

/**
 * A failed send's Retry and Delete (the list's one sender, `retryOptimisticMessage`). Every row calls it, so a row keeps
 * one component type from pending to failed to retrying to sent: Retry keeps keyboard focus while it is busy. While
 * the retry runs the row still shows as failed with Retry busy (the message itself is pending again); when it is
 * done and Retry goes away, focus that was on it goes to the row.
 */
function useFailedSend(message: Message, row: { current: HTMLDivElement | null }) {
  const { retrySend, removeFailed } = useShared();
  const retry = useCallback(() => retrySend(message), [retrySend, message]);
  const remove = useCallback(() => removeFailed(message), [removeFailed, message]);
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
      if (!mounted.current) return;
      const hadFocus = row.current?.contains(document.activeElement) === true;
      setRetrying(false);
      if (hadFocus) {
        requestAnimationFrame(() => {
          const node = row.current;
          if (node !== null && !node.contains(document.activeElement)) node.focus({ preventScroll: true });
        });
      }
    });
  }, [retry, row]);
  const shown = message.sendStatus === 'failed' || retrying;
  return shown ? { onRetry, onDelete: remove, retrying } : undefined;
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

function Attachment({ file, message }: { file: AttachmentView; message: Message }): JSX.Element {
  if (file.kind === 'video') return <VideoAttachment file={file} />;
  if (file.kind === 'audio') return <AudioAttachment file={file} />;
  return <FileAttachment file={file} message={message} />;
}

/** A picture (pressing it opens the viewer at it) or a file to download. */
function FileAttachment({ file, message }: { file: AttachmentView; message?: Message }): JSX.Element {
  const { opener, openViewer } = useShared();
  const busy = useAttachmentBusy(opener, file.id);
  // Only a raster picture the opener would show is drawn (its thumbnail, falling back to the file). Any other type,
  // an SVG or a "picture" whose type says otherwise, is a file tile: nothing fetched until pressed, then downloaded.
  const drawn = file.kind === 'image' && attachmentAction(file.mimeType) === 'open';
  const { blobUrl } = useAuthenticatedFile(drawn ? file.id : null, { fetchThumbnail: true });
  return (
    <AttachmentTile
      kind={drawn ? 'image' : 'file'}
      name={file.name}
      detail={file.detail}
      src={blobUrl ?? undefined}
      width={file.width}
      height={file.height}
      busy={busy}
      onOpen={
        // Only a raster picture the opener would show opens the viewer; every other type is downloaded, as before.
        drawn && message !== undefined && viewableImages(message.attachments).some((a) => a.id === file.id)
          ? () => openViewer(message, file.id)
          : () => opener.open({ id: file.id, name: file.name, mimeType: file.mimeType })
      }
    />
  );
}

/**
 * A video: its still under Play; nothing is fetched until Play, then the address (the old row's `useVideoUrl`: the
 * file's own address, the session cookie goes with it) and the browser's player in the same box.
 */
function VideoAttachment({ file }: { file: AttachmentView }): JSX.Element {
  const [play, setPlay] = useState(false);
  const { url } = useVideoUrl(play ? file.id : null);
  const poster = useVideoPoster(file);
  return (
    <AttachmentTile
      kind="video"
      name={file.name}
      detail={file.detail}
      poster={poster}
      src={play ? (url ?? undefined) : undefined}
      width={file.width}
      height={file.height}
      busy={play && url === null}
      onOpen={() => setPlay(true)}
    />
  );
}

/**
 * A video's still: its thumbnail only, as the old `VideoPreview` (the file cache's `fetchThumbnail`, no fallback to
 * the whole file): a missing still leaves the quiet fill and never pulls the video before Play.
 */
function useVideoPoster(file: AttachmentView): string | undefined {
  const fileCache = useFileCache();
  const [poster, setPoster] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!file.hasThumbnail) return;
    let cancelled = false;
    fileCache
      .fetchThumbnail(file.id)
      .then((url) => {
        if (!cancelled) setPoster(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [file.id, file.hasThumbnail, fileCache]);
  return poster;
}

/** An audio file: a row with Play; Play fetches it (as the old player, through the file cache) and plays it in place. */
function AudioAttachment({ file }: { file: AttachmentView }): JSX.Element {
  const { opener } = useShared();
  const downloading = useAttachmentBusy(opener, file.id);
  const [play, setPlay] = useState(false);
  const { blobUrl, error } = useAuthenticatedFile(play ? file.id : null, { fetchBlob: true, fetchMetadata: false });
  // It could not be fetched: the same tile turns into the download (the opener reports a failure there); the button
  // stays the same element, so focus on it stays.
  if (play && error) {
    return (
      <AttachmentTile
        kind="file"
        name={file.name}
        detail={file.detail}
        busy={downloading}
        onOpen={() => opener.open({ id: file.id, name: file.name, mimeType: file.mimeType })}
      />
    );
  }
  return (
    <AttachmentTile
      kind="audio"
      name={file.name}
      detail={file.detail}
      src={play ? (blobUrl ?? undefined) : undefined}
      busy={play && !blobUrl}
      onOpen={() => setPlay(true)}
    />
  );
}

/** GIF addresses that failed to draw this session: their rows show the words and the card instead. */
const failedGifs = createBoundedSet<string>(200);

/** A lone GIF link, drawn as the GIF (the old row's embed). Pressing it opens the GIF in a new tab, as there. */
function GifAttachment({ url, onFailed }: { url: string; onFailed: () => void }): JSX.Element {
  return (
    <AttachmentTile
      kind="image"
      name="GIF"
      src={url}
      remote
      onLoadError={onFailed}
      onOpen={() => window.open(url, '_blank', 'noopener,noreferrer')}
    />
  );
}

function Reactions({ message, row }: { message: Message; row: { current: HTMLDivElement | null } }): JSX.Element | null {
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
          aria-disabled={!canReact || !shared.writable}
          onUnavailablePress={() => announce("You can't react in this channel")}
          onToggle={() => void handleReactionClick(reaction.key)}
          onShowPeople={() => {
            // Focus comes back to the chip that asked when it had focus, else to the row (a touch long press focuses nothing).
            const active = document.activeElement;
            const returnTo = active instanceof HTMLElement && row.current?.contains(active) ? active : row.current;
            shared.showReactions(message, reaction.key, returnTo);
          }}
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
  const { editing } = shared;
  useEffect(() => {
    handleEditClick();
    // The row came back into the list mid-edit: what the reader had typed, not the original.
    const draft = editing.draft(message.id);
    if (draft !== null) setEditText(draft);
    setStarted(true);
    // The field takes focus once the actions sheet has given it back to the row, and only when the edit starts.
    const frame = requestAnimationFrame(() => {
      const input = field.current;
      if (input === null || !editing.claimFocus(message.id)) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the editor mounts
  }, []);
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
      onChange={(text) => {
        setEditText(text);
        editing.setDraft(message.id, text);
      }}
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

/**
 * A failed send's reason: a time-out the reader is under, from the channel's capabilities (as the old row), else the
 * server's words. Only a failed row asks for the capabilities.
 */
function useFailedReason(message: Message, communityId: string, serverReason: string | undefined): string | undefined {
  const failed = message.sendStatus === 'failed';
  const { timedOutUntil } = useChannelPermissions(failed && message.channelId ? communityId : undefined, message.channelId ?? undefined);
  return failed ? sendFailureReason(serverReason, timedOutUntil) : serverReason;
}

export function repliesText(count: number): string {
  return count === 1 ? '1 reply' : `${count} replies`;
}

/** The row's "3 replies": a button that opens the thread (focus comes back to it when the thread closes). */
function RepliesButton({ message, open }: { message: Message; open: (message: Message, opener: HTMLElement | null) => void }): JSX.Element {
  const button = useRef<HTMLButtonElement>(null);
  return (
    <Button
      ref={button}
      variant="text"
      size="sm"
      startIcon={<Icon name="MessageSquare" size="sm" />}
      aria-label={`${repliesText(message.replyCount)}, open the thread`}
      onClick={() => open(message, button.current)}
    >
      {repliesText(message.replyCount)}
    </Button>
  );
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
}: ChatRowProps): JSX.Element {
  const shared = useShared();
  const rowRef = useRef<HTMLDivElement>(null);
  const failed = useFailedSend(message, rowRef);
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
  // A lone GIF link is drawn as the GIF, without its words or a preview card; one that fails falls back to both.
  // A failure is remembered by address for the session, so a row the list remounts does not retry it (and jump).
  const [, setGifFailures] = useState(0);
  const onGifFailed = useCallback((url: string) => {
    failedGifs.add(url);
    setGifFailures((n) => n + 1);
  }, []);
  // "Load pictures and previews from other sites" off: the GIF stays its link, the cards keep only their words and a
  // webhook keeps its initial (none of those pictures is fetched).
  const loadRemote = useLoadRemoteContent();
  const lone = isEditing || !loadRemote ? null : getMessageLoneGifUrl(message);
  // The kit's link check too (no user name or password in the address: its words are hidden, so nobody would see it).
  const checkedGif = lone === null ? null : safeHref(lone);
  const gifUrl = checkedGif === null || failedGifs.has(checkedGif) ? null : checkedGif;
  const cards = gifUrl === null ? toLinkCards(message.linkPreviews, { pictures: loadRemote }) : [];
  const failedReason = useFailedReason(message, shared.communityId, view.failedReason);
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
        avatarSrc={(loadRemote ? view.webhookAvatar : undefined) ?? avatar ?? undefined}
        // A person's colour from their id; a webhook keeps the neutral fill.
        avatarColour={isWebhook ? undefined : personColour(authorId)}
        time={view.time}
        dateTime={view.dateTime}
        timeLabel={view.timeLabel}
        continued={grouped}
        mentioned={view.mentioned}
        highlighted={isHighlighted}
        state={failed?.retrying ? 'failed' : view.state}
        failedReason={failedReason}
        edited={view.edited}
        pinned={view.pinned}
        quote={message.replyTo ? <Quote replyTo={message.replyTo} /> : undefined}
        body={
          isEditing ? (
            <InlineEdit message={message} row={rowRef} />
          ) : gifUrl !== null ? undefined : segments.length > 0 ? (
            <MessageText segments={segments} onMention={onMention} />
          ) : undefined
        }
        attachments={
          files.length > 0 || pendingUpload !== undefined || gifUrl !== null || cards.length > 0 ? (
            <Stack gap="sm" align="start">
              {gifUrl !== null && <GifAttachment url={gifUrl} onFailed={() => onGifFailed(gifUrl)} />}
              {files.map((file) => (
                <Attachment key={file.id} file={file} message={message} />
              ))}
              <Uploads message={message} />
              {cards.map((card, i) => (
                <LinkCard key={`${i}:${card.href}`} {...card} />
              ))}
            </Stack>
          ) : undefined
        }
        reactions={!view.optimistic && message.reactions.length > 0 ? <Reactions message={message} row={rowRef} /> : undefined}
        footer={
          // Inside a thread the parent's count is the separator under it; a pending or failed row has no thread.
          message.replyCount > 0 && shared.openThread !== undefined && !view.optimistic ? (
            <RepliesButton message={message} open={shared.openThread} />
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

export const ChatRow = memo(ChatRowBody);
