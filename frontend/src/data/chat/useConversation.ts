/**
 * A text channel's conversation for the new shell's chat screen: one hook over the shared chat layer, so the
 * screen stays a view and a native shell can mirror the same model. Every behaviour comes from the hooks the old
 * chat uses (`components/Message/MessageContainer.tsx`, `components/Channel/ChannelMessageContainer.tsx`), called
 * the same way: the messages and the `?highlight=` jump (`useChannelChat`), read marks and the unread divider
 * (`useReadMarks`), the anchored-to-live transition, the new-message announcement, typing, and marking the
 * channel's notifications read. What is new is only the "N new" count (`useNewWhileAway`) and that the three
 * "jump" buttons of the old chat are one Jump to latest here (the same three actions, chosen the same way).
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { MessageListCoreHandle } from '../../features/chat/MessageListCore';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { useAnchoredModeTransition } from '../../hooks/useAnchoredModeTransition';
import { useAutoMarkNotificationsRead } from '../../hooks/useAutoMarkNotificationsRead';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useMessageListAnnouncer } from '../../hooks/useMessageListAnnouncer';
import { useTypingUsers } from '../../hooks/useTypingUsers';
import type { Message } from '../../types/message.type';
import { useChannelChat } from './useChannelChat';
import { useNewWhileAway } from './useNewWhileAway';
import { useReadMarks } from './useReadMarks';

export interface UseConversationOptions {
  communityId: string;
  channelId: string;
  /** Where clearing `?highlight=` leads (`useChannelChat`'s `chatPath`). Default: the app's channel route. */
  chatPath?: string;
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

export function useConversation({ communityId, channelId, chatPath }: UseConversationOptions): Conversation {
  const { user } = useCurrentUser();
  const me = user?.id ?? '';

  useAutoMarkNotificationsRead({ contextType: VoiceSessionType.Channel, contextId: channelId });

  const { messagesHookResult } = useChannelChat(channelId, communityId, { chatPath });
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
    contextKey: channelId,
    enabled: !isLoading,
  });

  useAnchoredModeTransition({ mode, atBottom, hasNewer, isLoadingNewer, jumpToPresent });

  const { handleDetachedJumpToPresent, handleVisibleRangeChange, unreadCount, lastReadIndex } = useReadMarks({
    orderedMessages,
    isLoading,
    channelId,
    contextKey: channelId,
    isDetachedFromPresent,
    resetToPresent,
    scrollToBottomRef,
    atBottomRef,
  });

  const newCount = useNewWhileAway({ orderedMessages, atBottom, authorId: me, contextKey: channelId });
  const typingUserIds = useTypingUsers({ channelId, currentUserId: me });

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
      resetKey: channelId,
      onAtBottomChange: setAtBottom,
      onVisibleRangeChange: handleVisibleRangeChange,
    },
    jump,
    typingUserIds,
    announcement,
  };
}
