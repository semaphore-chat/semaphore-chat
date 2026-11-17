/**
 * A thread in the new shell's chat (PR 10d-B): full screen over its channel (the kit ChatPane's `cover`; the channel
 * stays mounted underneath with its scroll), opened from a row's "3 replies" or "Reply in thread". The parent
 * message first, then the replies oldest first on the shared list core (`startAt="start"`, as the old phone thread
 * opens at the top), the next page loading near the end, the reply composer (the channel's, in its thread mode:
 * mentions, files, the keys and the input-method guard), and Follow. Its state is the URL's `?thread=` (Back closes
 * it); the shared thread model is `data/chat/useThreadConversation`. Nothing is marked read here (the old thread
 * panel tracks no read state for threads) and nobody's typing is shown (threads have none).
 *
 * Focus: the heading takes focus and is announced when the thread opens; the screen gives focus back to the opener
 * when it closes.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react';
import {
  Button,
  ChatPane,
  IconButton,
  ListSeparator,
  Skeleton,
  Stack,
  Text,
  useAnnounce,
} from '../../../../kit';
import MessageListCore, { type MessageListCoreHandle, type MessageRowContext } from '../../../../features/chat/MessageListCore';
import { useThreadConversation } from '../../../../data/chat/useThreadConversation';
import type { EditingStore } from '../../../../data/chat/editingStore';
import { useMessageListAnnouncer } from '../../../../hooks/useMessageListAnnouncer';
import { getHttpStatus } from '../../../../utils/httpError';
import type { Message } from '../../../../types/message.type';
import { ChatRow, ChatRowContext, repliesText, type ChatRowShared } from './ChatRow';
import { ChatComposer } from './ChatComposer';

export interface ThreadViewProps {
  communityId: string;
  channelId: string;
  /** "#lobby", for Back's name; null while unknown. */
  channelTitle: string | null;
  parentMessageId: string;
  /** The parent as the channel's loaded window has it (live), or null to fetch it by id. */
  parent: Message | null;
  /** A known text channel: the composer and Follow (writes) only then. */
  writable: boolean;
  /** The channel rows' shared context; the thread's rows take it with their own edit state and no thread button. */
  shared: ChatRowShared;
  editing: EditingStore;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onClose: () => void;
}

function LoadingThread(): JSX.Element {
  return (
    <Stack gap="lg">
      <span role="status">
        <Text variant="small" tone="secondary">
          Loading the thread
        </Text>
      </span>
      {Array.from({ length: 3 }, (_, i) => (
        <Stack key={i} direction="row" gap="md">
          <Skeleton shape="circle" size="md" />
          <Stack gap="xs" fill>
            <Skeleton shape="text" lines={i === 0 ? 2 : 1} />
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}

function ThreadState({ title, line, action }: { title: string; line?: string; action?: JSX.Element }): JSX.Element {
  return (
    <Stack gap="sm" align="start">
      <Text variant="title" as="h2">
        {title}
      </Text>
      {line !== undefined && <Text tone="secondary">{line}</Text>}
      {action}
    </Stack>
  );
}

function ThreadHeader({
  backLabel,
  onBack,
  follow,
}: {
  backLabel: string;
  onBack: () => void;
  follow?: { following: boolean; onToggle: () => void };
}): JSX.Element {
  const back = useRef<HTMLButtonElement>(null);
  const announce = useAnnounce();
  // The heading takes focus once, when the thread opens (a script focus: no ring, as RouteFocus does it), and the
  // thread is announced.
  useEffect(() => {
    const heading = back.current?.parentElement?.querySelector('h1');
    if (heading instanceof HTMLElement) {
      if (!heading.hasAttribute('tabindex')) {
        heading.setAttribute('tabindex', '-1');
        heading.style.outline = 'none';
      }
      heading.focus({ preventScroll: true });
    }
    announce('Thread');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the thread opens
  }, []);
  return (
    <Stack direction="row" gap="sm">
      <IconButton ref={back} icon="ArrowLeft" label={backLabel} variant="ghost" onClick={onBack} />
      <Stack direction="row" gap="xs" fill>
        <Text variant="title" as="h1" truncate>
          Thread
        </Text>
      </Stack>
      {follow !== undefined && (
        <IconButton
          icon={follow.following ? 'Bell' : 'BellOff'}
          label="Follow thread"
          variant="ghost"
          selected={follow.following}
          onClick={follow.onToggle}
        />
      )}
    </Stack>
  );
}

export function ThreadView({
  communityId,
  channelId,
  channelTitle,
  parentMessageId,
  parent,
  writable,
  shared,
  editing,
  inputRef,
  onClose,
}: ThreadViewProps): JSX.Element {
  const thread = useThreadConversation({ parentMessageId, parent });
  const parentMessage = thread.parent;
  // A parent from another channel (a hand-made link) is not this channel's thread.
  const foreign = parentMessage !== null && parentMessage.channelId !== null && parentMessage.channelId !== channelId;
  const listRef = useRef<MessageListCoreHandle>(null);
  const [atBottom, setAtBottom] = useState(false);

  const orderedMessages = useMemo(
    () => (parentMessage === null || foreign ? [] : [parentMessage, ...thread.replies]),
    [parentMessage, foreign, thread.replies],
  );
  const announcement = useMessageListAnnouncer({
    orderedMessages,
    atBottom,
    authorId: shared.me,
    contextKey: parentMessageId,
    enabled: !thread.isLoading,
  });

  // The reader's own reply: once it is in the list, down to it (the old thread did the same for every reply).
  const followOwn = useRef(false);
  const onSent = useCallback(() => {
    followOwn.current = true;
    requestAnimationFrame(() => listRef.current?.scrollToBottom());
  }, []);
  const newest = orderedMessages[orderedMessages.length - 1];
  useEffect(() => {
    if (!followOwn.current || newest === undefined || newest.authorId !== shared.me) return;
    followOwn.current = false;
    requestAnimationFrame(() => listRef.current?.scrollToBottom());
  }, [newest, shared.me]);

  const threadShared = useMemo<ChatRowShared>(() => ({ ...shared, editing, openThread: undefined }), [shared, editing]);
  const replyCount = thread.replies.length;
  const renderRow = useCallback(
    (message: Message, ctx: MessageRowContext) => (
      <>
        <ChatRow
          message={message}
          index={ctx.index}
          grouped={ctx.grouped}
          dayShownAbove={ctx.dayShownAbove}
          showDaySeparator={ctx.showDaySeparator}
          showUnreadDivider={false}
          isHighlighted={false}
          tabStop={ctx.isRovingFocused}
          onRovingKeyDown={ctx.onRovingKeyDown}
          onRovingFocus={ctx.onRovingFocus}
        />
        {ctx.index === 0 && <ListSeparator variant="day" label={replyCount === 0 ? 'No replies yet' : repliesText(replyCount)} />}
      </>
    ),
    [replyCount],
  );
  const escapeToInput = useCallback(() => inputRef.current?.focus({ preventScroll: true }), [inputRef]);

  const backLabel = channelTitle ? `Back to ${channelTitle}` : 'Back to the channel';
  const parentGone = !thread.parentLoading && (parentMessage === null || foreign);
  const parentStatus = getHttpStatus(thread.parentError);
  const state =
    thread.parentLoading || (thread.isLoading && !parentGone) ? (
      <LoadingThread />
    ) : parentGone ? (
      <ThreadState
        title={parentStatus === 403 ? "You can't see this thread" : 'This thread is gone'}
        line={
          parentStatus === 403
            ? 'You may not have access to the message it is on.'
            : 'The message it was on may have been deleted, or the link is wrong.'
        }
        action={<Button onClick={onClose}>{backLabel}</Button>}
      />
    ) : thread.error ? (
      <ThreadState title="Couldn't load replies" action={<Button onClick={() => void thread.refetch()}>Try again</Button>} />
    ) : undefined;

  return (
    <ChatRowContext value={threadShared}>
      <ChatPane
        header={
          <ThreadHeader
            backLabel={backLabel}
            onBack={onClose}
            follow={writable && !parentGone ? { following: thread.isSubscribed, onToggle: () => void thread.toggleSubscription() } : undefined}
          />
        }
        state={state}
        list={
          state === undefined ? (
            <MessageListCore
              ref={listRef}
              orderedMessages={orderedMessages}
              renderRow={renderRow}
              startAt="start"
              resetKey={parentMessageId}
              isLoadingMore={false}
              hasNewer={thread.continuationToken !== undefined}
              onLoadNewer={thread.loadMore}
              isLoadingNewer={thread.isLoadingMore}
              unreadCount={0}
              lastReadIndex={-1}
              onAtBottomChange={setAtBottom}
              onEscapeToInput={escapeToInput}
            />
          ) : undefined
        }
        announcement={announcement}
        composer={
          writable && state === undefined ? (
            <ChatComposer
              communityId={communityId}
              channelId={channelId}
              me={shared.me}
              inputRef={inputRef}
              replyTo={null}
              onCancelReply={noop}
              thread={{ parentMessageId, onSent }}
            />
          ) : undefined
        }
      />
    </ChatRowContext>
  );
}

const noop = () => undefined;
