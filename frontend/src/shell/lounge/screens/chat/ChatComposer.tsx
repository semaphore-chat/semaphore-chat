/**
 * The chat's composer (PR 10c-2a): the kit `Composer` on the shared composer model (`data/chat/useChannelComposer`)
 * and the shared send (`hooks/useMessageFileUpload`). Its draft, mention list and queued files are its own state, so
 * typing re-renders only the composer, never a message row.
 */
import { useCallback, useId, type JSX, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AttachmentTile,
  Composer,
  SuggestionList,
  useAnnounce,
  useKeyboardInset,
  useToasts,
  useWidthRange,
  type ComposerBanner,
  type ComposerNotice,
  type IconName,
  type Suggestion,
} from '../../../../kit';
import { userControllerGetUserByIdOptions } from '../../../../api-client/@tanstack/react-query.gen';
import { ACCEPTED_FILE_TYPES } from '../../../../constants/messages';
import { VoiceSessionType } from '../../../../contexts/VoiceContext';
import { useChannelComposer, type ComposerNoticeKind } from '../../../../data/chat/useChannelComposer';
import { useTouchFirst } from '../../../../data/touchFirst';
import { useMessageFileUpload } from '../../../../hooks/useMessageFileUpload';
import type { MentionSuggestion } from '../../../../hooks/useMentionAutocomplete';
import type { Message, Span } from '../../../../types/message.type';
import { spansToText } from '../../../../utils/mentionParser';

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
    ...(mention.type === 'user' ? { avatar: {} } : { icon: mention.type === 'alias' ? 'Users' : 'Megaphone' }),
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
}

function useReplyBanner(replyTo: Message | null, onCancel: () => void): ComposerBanner | undefined {
  const { data: author } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: replyTo?.authorId ?? '' } }),
    enabled: !!replyTo?.authorId,
  });
  if (replyTo === null) return undefined;
  const name = replyTo.webhook?.name ?? (author?.displayName || author?.username || 'a message');
  const line = spansToText(replyTo.spans).split('\n')[0];
  return { kind: 'reply', title: `Replying to ${name}`, detail: line || undefined, cancelLabel: 'Cancel reply', onCancel };
}

export function ChatComposer({ communityId, channelId, me, inputRef, replyTo, onCancelReply }: ChatComposerProps): JSX.Element {
  const toasts = useToasts();
  const announce = useAnnounce();
  const onError = useCallback((message: string) => void toasts.show({ tone: 'danger', message }), [toasts]);
  const { handleSendMessage } = useMessageFileUpload({ contextType: VoiceSessionType.Channel, contextId: channelId, authorId: me, onError });
  const range = useWidthRange();
  const touch = useTouchFirst(range);
  const keyboardUp = useKeyboardInset() > 0;
  const replyId = replyTo?.id;
  const send = useCallback(
    async (content: string, spans: Span[], files: File[]) => {
      // The reply goes with this send; the banner closes at once (as the old composer).
      onCancelReply();
      await handleSendMessage(content, spans, files, replyId);
    },
    [handleSendMessage, onCancelReply, replyId],
  );
  const composer = useChannelComposer({
    communityId,
    channelId,
    inputRef,
    send,
    onError,
    touch,
    onCancelReply: replyTo !== null ? onCancelReply : undefined,
  });
  const banner = useReplyBanner(replyTo, onCancelReply);
  const listId = `${useId()}-mentions`;
  const optionId = useCallback((index: number) => `${listId}-${index}`, [listId]);

  const notice: ComposerNotice | undefined =
    composer.notice === null ? undefined : { text: composer.notice.text, icon: NOTICE_ICON[composer.notice.kind] };
  const { attach, mentions } = composer;
  const label = composer.channelName ? `Message #${composer.channelName}` : 'Message';

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
    </>
  );
}
