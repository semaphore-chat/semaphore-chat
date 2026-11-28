/**
 * A text channel's conversation for the new shell's chat screen: one hook over the shared chat layer, so the
 * screen stays a view and a native shell can mirror the same model. Every behaviour comes from the hooks the old
 * chat uses (`components/Message/MessageContainer.tsx`, `components/Channel/ChannelMessageContainer.tsx`), called
 * the same way: the messages and the `?highlight=` jump (`useChannelChat`), read marks and the unread divider
 * (`useReadMarks`), the anchored-to-live transition, the new-message announcement, typing, and marking the
 * channel's notifications read. What is new is only the "N new" count (`useNewWhileAway`) and that the three
 * "jump" buttons of the old chat are one Jump to latest here (the same three actions, chosen the same way).
 *
 * A DM group's conversation (`target: { kind: 'dm', dmGroupId }`) is the same model on the DM variants of those
 * hooks, as the old shell's DM screen (`components/DirectMessages/DirectMessageContainer.tsx`) calls them.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { MessageListCoreHandle } from '../../features/chat/MessageListCore';
import { useAnchoredModeTransition } from '../../hooks/useAnchoredModeTransition';
import { useAutoMarkNotificationsRead } from '../../hooks/useAutoMarkNotificationsRead';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useMessageListAnnouncer } from '../../hooks/useMessageListAnnouncer';
import { useTypingUsers } from '../../hooks/useTypingUsers';
import type { Message } from '../../types/message.type';
import { useChannelChat } from './useChannelChat';
import { chatTargetContext, chatTargetId, chatTargetIds, resolveChatTarget, type ChatTargetArgs } from './chatTarget';
import { useNewWhileAway } from './useNewWhileAway';
import { useReadMarks } from './useReadMarks';

/** A `target` (a channel or a DM group), or the channel's `communityId` + `channelId`. */
export type UseConversationOptions = ChatTargetArgs & ConversationOptions;

interface ConversationOptions {
  /** Where clearing `?highlight=` leads (`useChannelChat`'s `chatPath`). Default: the app's channel route. */
  chatPath?: string;
  /**
   * Another conversation covers this one (a thread over its channel; this list stays mounted underneath): nothing
   * is marked read and nothing is announced while covered. Uncovered again, the last range the list reported is
   * read as if it had just been reported, so what arrived meanwhile in view is read then, not before.
   */
  covered?: boolean;
}

export interface ConversationJump {
  /** Whether Jump to latest shows. */
  shown: boolean;
  /** Others' messages that arrived while away from the bottom. */
  newCount: number;
  onJump: () => void;
}

export interface Conversation {
  me: string;
  /** Oldest first, as the list core renders them. */
  orderedMessages: Message[];
  isLoading: boolean;
  error: unknown;
  listRef: RefObject<MessageListCoreHandle | null>;
  /** The props the list core needs, besides `renderRow` and `orderedMessages`. */
  list: {
    mode: 'normal' | 'anchored';
    isLoadingMore: boolean;
    continuationToken?: string;
    onLoadMore?: () => Promise<void>;
    onLoadNewer?: () => Promise<void>;
    isLoadingNewer?: boolean;
    hasNewer?: boolean;
    unreadCount: number;
    lastReadIndex: number;
    highlightMessageId?: string;
    highlightSeq?: number;
    resetKey: string;
    onAtBottomChange: (atBottom: boolean) => void;
    onVisibleRangeChange: (startIndex: number, endIndex: number) => void;
  };
  jump: ConversationJump;
  /** Who is typing (user ids, not the reader). */
  typingUserIds: string[];
  /** The polite announcement of new messages while away from the bottom. */
  announcement: string;
}

export function useConversation({ chatPath, covered = false, ...targetArgs }: UseConversationOptions): Conversation {
  const target = resolveChatTarget(targetArgs as ChatTargetArgs);
  // The conversation's identity: the channel id or the DM group id.
  const contextKey = chatTargetId(target);
  const ids = chatTargetIds(target);
  const { user } = useCurrentUser();
  const me = user?.id ?? '';

  useAutoMarkNotificationsRead(chatTargetContext(target));

  const { messagesHookResult } = useChannelChat(target, { chatPath });
  const {
    messages,
    isLoading,
    error,
    continuationToken,
    isLoadingMore,
    onLoadMore,
    mode,
    jumpToPresent,
    highlightMessageId,
    highlightSeq,
    onLoadNewer,
    isLoadingNewer,
    hasNewer,
  } = messagesHookResult;
  // Only the live (normal) window can detach from the present (#404); the anchored window has no such state.
  const isDetachedFromPresent = 'isDetachedFromPresent' in messagesHookResult ? messagesHookResult.isDetachedFromPresent : undefined;
  const resetToPresent = 'resetToPresent' in messagesHookResult ? messagesHookResult.resetToPresent : undefined;

  // The query hands them newest first; the list renders oldest first (as MessageContainer).
  const orderedMessages = useMemo(() => [...messages].reverse(), [messages]);

  const listRef = useRef<MessageListCoreHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scrollToBottom = useCallback(() => listRef.current?.scrollToBottom(), []);
  const scrollToBottomRef = useRef(scrollToBottom);
  const atBottomRef = useRef(atBottom);
  useLayoutEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
    atBottomRef.current = atBottom;
  });

  const announcement = useMessageListAnnouncer({
    orderedMessages,
    atBottom,
    authorId: me,
    contextKey,
    enabled: !isLoading,
  });

  useAnchoredModeTransition({ mode, atBottom, hasNewer, isLoadingNewer, jumpToPresent });

  const { handleDetachedJumpToPresent, handleVisibleRangeChange, unreadCount, lastReadIndex } = useReadMarks({
    orderedMessages,
    isLoading,
    ...ids,
    contextKey,
    isDetachedFromPresent,
    resetToPresent,
    scrollToBottomRef,
    atBottomRef,
  });

  // While covered the list's range is only remembered; uncovered, the last one is read.
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  const lastRangeRef = useRef<[number, number] | null>(null);
  const onVisibleRangeChange = useCallback(
    (startIndex: number, endIndex: number) => {
      lastRangeRef.current = [startIndex, endIndex];
      if (!coveredRef.current) handleVisibleRangeChange(startIndex, endIndex);
    },
    [handleVisibleRangeChange],
  );
  useEffect(() => {
    const range = lastRangeRef.current;
    if (!covered && range !== null) handleVisibleRangeChange(range[0], range[1]);
  }, [covered, handleVisibleRangeChange]);

  const newCount = useNewWhileAway({
    orderedMessages,
    atBottom,
    authorId: me,
    contextKey,
    live: mode === 'normal' && !isDetachedFromPresent,
  });
  const typingUserIds = useTypingUsers({ ...ids, currentUserId: me });

  // The old chat's three buttons, in its order: back to the present from a jump, back to the live edge from a
  // detached window (#404), or down to the bottom.
  const jump: ConversationJump =
    mode === 'anchored' && jumpToPresent
      ? { shown: true, newCount, onJump: jumpToPresent }
      : mode === 'normal' && isDetachedFromPresent && resetToPresent
        ? { shown: true, newCount, onJump: handleDetachedJumpToPresent }
        : { shown: !atBottom, newCount, onJump: scrollToBottom };

  return {
    me,
    orderedMessages,
    isLoading,
    error,
    listRef,
    list: {
      mode,
      isLoadingMore,
      continuationToken,
      onLoadMore,
      onLoadNewer,
      isLoadingNewer,
      hasNewer,
      unreadCount,
      lastReadIndex,
      highlightMessageId,
      highlightSeq,
      resetKey: contextKey,
      onAtBottomChange: setAtBottom,
      onVisibleRangeChange,
    },
    jump,
    typingUserIds,
    announcement: covered ? '' : announcement,
  };
}
