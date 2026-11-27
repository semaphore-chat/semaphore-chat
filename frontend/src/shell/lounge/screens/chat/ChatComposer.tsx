/**
 * The chat's composer (PR 10c-2a): the kit `Composer` on the shared composer model (`data/chat/useChannelComposer`)
 * and the shared send (`hooks/useMessageFileUpload`). Its draft, mention list and queued files are its own state, so
 * typing re-renders only the composer, never a message row.
 *
 * The extras (PR 10d-C): the emoji button opens the emoji picker (it inserts at the caret), the GIF button the GIF
 * search (a pick is sent at once; only when the server has GIF search on), a pasted picture or file goes to the
 * tray, files dropped on the conversation too (`composerDrop`), and ↑ in the empty field edits the reader's last
 * message (`onEditLastMessage`). Neither picker is offered while the reader cannot write (the notice shows instead).
 */
import { stripBidiOverrides } from '../../../../kit';
import { useCallback, useEffect, useId, useRef, useState, type JSX, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AttachmentTile,
  Composer,
  IconButton,
  SuggestionList,
  useAnnounce,
  useKeyboardInset,
  useToasts,
  personColour,
  useWidthRange,
  type ComposerBanner,
  type ComposerNotice,
  type IconName,
  type Suggestion,
} from '../../../../kit';
import {
  instanceControllerGetPublicSettingsOptions,
  userControllerGetUserByIdOptions,
} from '../../../../api-client/@tanstack/react-query.gen';
import type { GifResultDto } from '../../../../api-client/types.gen';
import { pickText, type EmojiPick } from '../../../../data/chat/useEmojiPicker';
import { ACCEPTED_FILE_TYPES } from '../../../../constants/messages';
import { VoiceSessionType } from '../../../../contexts/VoiceContext';
import { useChannelComposer, type ComposerNoticeKind } from '../../../../data/chat/useChannelComposer';
import { useThreadReplySend } from '../../../../data/chat/useThreadReplySend';
import { useTouchFirst } from '../../../../data/touchFirst';
import { useMessageFileUpload } from '../../../../hooks/useMessageFileUpload';
import type { MentionSuggestion } from '../../../../hooks/useMentionAutocomplete';
import type { Message, Span } from '../../../../types/message.type';
import { spansToText } from '../../../../utils/mentionParser';
import type { DropInto } from './composerDrop';
import { EmojiPickerSheet } from './EmojiPickerSheet';
import { GifPickerSheet, gifSendUrl } from './GifPickerSheet';

const NOTICE_ICON: Record<ComposerNoticeKind, IconName> = {
  'read-only': 'Megaphone',
  'no-permission': 'Lock',
  'timed-out': 'Shield',
  banned: 'Lock',
};

function toSuggestion(mention: MentionSuggestion): Suggestion {
  return {
    key: `${mention.type}:${mention.id}`,
    label: mention.displayName,
    detail: mention.subtitle,
    ...(mention.type === 'user' ? { avatar: { colour: personColour(mention.id) } } : { icon: mention.type === 'alias' ? 'Users' : 'Megaphone' }),
  };
}

export interface ChatComposerProps {
  communityId: string;
  channelId: string;
  me: string;
  /** The field: Escape in the message list comes back to it. */
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** The message being replied to, or null. */
  replyTo: Message | null;
  onCancelReply: () => void;
  /**
   * A reply in this message's thread (the thread view's composer): the thread's draft and send, no quote reply.
   * `onSent` runs once the server has the reply.
   */
  thread?: { parentMessageId: string; onSent?: () => void };
  /** Files dragged over the conversation: the composer is the drop target. */
  dropActive?: boolean;
  /** Where the conversation's drop zone puts dropped files (set by the composer while it can take them). */
  dropInto?: DropInto;
  /** ↑ in the empty field (hardware keyboard): edit the reader's last message; false when there is none. */
  onEditLastMessage?: () => boolean;
}

function useReplyBanner(replyTo: Message | null, onCancel: () => void): ComposerBanner | undefined {
  const { data: author } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: replyTo?.authorId ?? '' } }),
    enabled: !!replyTo?.authorId,
  });
  if (replyTo === null) return undefined;
  const name = replyTo.webhook?.name ?? (author?.displayName || author?.username || 'a message');
  const line = stripBidiOverrides(spansToText(replyTo.spans).split('\n')[0]);
  return { kind: 'reply', title: `Replying to ${name}`, detail: line || undefined, cancelLabel: 'Cancel reply', onCancel };
}

export function ChatComposer({
  communityId,
  channelId,
  me,
  inputRef,
  replyTo,
  onCancelReply,
  thread,
  dropActive = false,
  dropInto,
  onEditLastMessage,
}: ChatComposerProps): JSX.Element {
  const toasts = useToasts();
  const announce = useAnnounce();
  const onError = useCallback((message: string) => void toasts.show({ tone: 'danger', message }), [toasts]);
  const { handleSendMessage } = useMessageFileUpload({ contextType: VoiceSessionType.Channel, contextId: channelId, authorId: me, onError });
  const range = useWidthRange();
  const touch = useTouchFirst(range);
  const keyboardUp = useKeyboardInset() > 0;
  const replyId = replyTo?.id;
  const sendInThread = useThreadReplySend({ parentMessageId: thread?.parentMessageId ?? '', channelId, onError });
  const threadId = thread?.parentMessageId;
  const onSent = thread?.onSent;
  const send = useCallback(
    async (content: string, spans: Span[], files: File[]) => {
      if (threadId !== undefined) {
        const sent = await sendInThread(content, spans, files);
        if (sent) onSent?.();
        return sent;
      }
      // The reply goes with this send; the banner closes at once (as the old composer).
      onCancelReply();
      await handleSendMessage(content, spans, files, replyId);
    },
    [handleSendMessage, onCancelReply, replyId, threadId, sendInThread, onSent],
  );
  const composer = useChannelComposer({
    communityId,
    channelId,
    thread: threadId !== undefined ? { parentMessageId: threadId } : undefined,
    inputRef,
    send,
    onError,
    touch,
    onCancelReply: replyTo !== null ? onCancelReply : undefined,
    onEditLastMessage,
  });
  const banner = useReplyBanner(replyTo, onCancelReply);
  const listId = `${useId()}-mentions`;
  const optionId = useCallback((index: number) => `${listId}-${index}`, [listId]);

  const notice: ComposerNotice | undefined =
    composer.notice === null ? undefined : { text: composer.notice.text, icon: NOTICE_ICON[composer.notice.kind] };
  const { attach, mentions } = composer;

  // Dropped files go to this composer's tray.
  const addFiles = attach.add;
  useEffect(() => {
    if (dropInto === undefined) return;
    dropInto.current = addFiles;
    return () => {
      if (dropInto.current === addFiles) dropInto.current = null;
    };
  }, [dropInto, addFiles]);

  // The pickers: one open at a time, focus back on its button when it closes.
  const [picker, setPicker] = useState<'emoji' | 'gif' | null>(null);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const gifButton = useRef<HTMLButtonElement>(null);
  const closePicker = useCallback(() => setPicker(null), []);
  const { insertText, sendLink } = composer;
  const pickEmoji = useCallback((pick: EmojiPick) => insertText(pickText(pick)), [insertText]);
  const pickGif = useCallback((gif: GifResultDto) => void sendLink(gifSendUrl(gif)), [sendLink]);
  const { data: publicSettings } = useQuery(instanceControllerGetPublicSettingsOptions());
  const gifSearch = publicSettings?.gifSearchEnabled === true;
  const label = thread !== undefined ? 'Reply in thread' : composer.channelName ? `Message #${composer.channelName}` : 'Message';

  return (
    <>
      <Composer
        ref={inputRef}
        label={label}
        value={composer.text}
        onChange={composer.onChange}
        onCaretMove={composer.onCaretMove}
        onKeyDown={composer.onKeyDown}
        onSubmit={() => void composer.send()}
        onPasteFiles={attach.add}
        dropTarget={{ active: dropActive, label: attach.allowed ? 'Drop files to attach them' : attach.unavailableText }}
        emoji={
          <>
            {gifSearch && (
              <IconButton ref={gifButton} icon="ImagePlay" label="Send a GIF" onClick={() => setPicker('gif')} />
            )}
            <IconButton ref={emojiButton} icon="Smile" label="Add emoji" onClick={() => setPicker('emoji')} />
          </>
        }
        canSend={composer.canSend}
        onSendUnavailablePress={() => announce('Write a message or attach a file first')}
        sending={composer.sending}
        submitOnEnter={!touch}
        cap={range === 'phone' ? (keyboardUp ? 'keyboard' : 'phone') : 'desktop'}
        onAttach={() => attach.inputRef.current?.click()}
        attachUnavailable={!attach.allowed}
        onAttachUnavailablePress={() => announce(attach.unavailableText)}
        banner={banner}
        notice={notice}
        attachments={
          attach.queued.length > 0 ? (
            <>
              {attach.queued.map((file) => (
                <AttachmentTile
                  key={file.key}
                  kind="file"
                  name={file.name}
                  detail={file.detail}
                  src={file.preview}
                  onRemove={() => attach.remove(file.index)}
                />
              ))}
            </>
          ) : undefined
        }
        popup={
          mentions === null
            ? undefined
            : { listId, activeId: mentions.suggestions.length > 0 ? optionId(mentions.activeIndex) : undefined }
        }
        suggestions={
          mentions === null ? undefined : (
            <SuggestionList
              id={listId}
              label="Mention suggestions"
              options={mentions.suggestions.map(toSuggestion)}
              activeIndex={mentions.activeIndex}
              optionId={optionId}
              onPick={mentions.pick}
              loading={mentions.loading}
            />
          )
        }
      />
      {/* The attach button opens the system's file picker through this input. */}
      <input
        ref={attach.inputRef}
        type="file"
        multiple
        hidden
        accept={ACCEPTED_FILE_TYPES}
        onChange={attach.onPicked}
        data-testid="chat-composer-file-input"
      />
      {picker === 'emoji' && composer.canCompose && (
        <EmojiPickerSheet
          title="Add emoji"
          communityId={communityId}
          touch={touch}
          opener={emojiButton.current}
          onPick={pickEmoji}
          onDone={closePicker}
        />
      )}
      {picker === 'gif' && composer.canCompose && gifSearch && (
        <GifPickerSheet touch={touch} opener={gifButton.current} onPick={pickGif} onDone={closePicker} />
      )}
    </>
  );
}
