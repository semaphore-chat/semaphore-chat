import type { QueryClient, InfiniteData } from '@tanstack/react-query';
import type {
  NewMessagePayload,
  UpdateMessagePayload,
  DeleteMessagePayload,
  ReactionAddedPayload,
  ReactionRemovedPayload,
  MessagePinnedPayload,
  MessageUnpinnedPayload,
  ThreadReplyCountUpdatedPayload,
  ReadReceiptUpdatedPayload,
} from '@semaphore-chat/shared';
import type { MessagesInfiniteData } from '../../utils/messageCacheUpdaters';
import type {
  UnreadCountDto,
  UserControllerGetProfileResponse,
  DmPeerReadDto,
  PaginatedMessagesResponseDto,
} from '../../api-client';
import { messageQueryKeyForContext, channelMessagesQueryKey } from '../../utils/messageQueryKeys';
import { isContextViewedAndFocused } from '../../utils/activeContextTracking';
import {
  readReceiptsControllerGetUnreadCountsQueryKey,
  readReceiptsControllerGetDmPeerReadsQueryKey,
  userControllerGetProfileQueryKey,
  moderationControllerGetPinnedMessagesQueryKey,
  directMessagesControllerFindUserDmGroupsQueryKey,
  threadsControllerGetRepliesQueryKey,
} from '../../api-client/@tanstack/react-query.gen';
import type { ThreadRepliesResponseDto } from '../../api-client';
import {
  prependOrReconcileOptimistic,
  updateMessageInInfinite,
  deleteMessageFromInfinite,
  findMessageInInfinite,
  isDetachedFromLiveEdge,
} from '../../utils/messageCacheUpdaters';
import type { SocketEventHandler } from './types';
import type { ServerEvents } from '@semaphore-chat/shared';

// TODO: WS handlers only update the normal message query cache. Anchored mode
// (jump-to-message) uses separate query keys and won't reflect real-time edits,
// deletes, or new messages. This is acceptable since anchored mode is transient
// (seconds), and the user gets fresh data on return to normal mode.

// Registered for both NEW_MESSAGE and NEW_DM (they share the same payload shape).
export const handleNewMessage: SocketEventHandler<
  typeof ServerEvents.NEW_MESSAGE | typeof ServerEvents.NEW_DM
> = async (
  { message }: NewMessagePayload,
  queryClient: QueryClient,
) => {
  const queryKey = messageQueryKeyForContext(message);
  if (!queryKey) return;
  const contextId = message.channelId || message.directMessageGroupId;
  if (!contextId) return;

  // At the MESSAGE_MAX_PAGES cap the newest page gets evicted and pages[0]
  // is mid-history — inserting there would corrupt the timeline (see #404).
  const existing = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
  const detached = isDetachedFromLiveEdge(existing);

  if (!detached) {
    await queryClient.cancelQueries({ queryKey });
    // Reconciles in place with a matching optimistic (pending/failed) row
    // from the same author if the echo beats the sender's own ack — see
    // prependOrReconcileOptimistic (PR-13).
    queryClient.setQueryData<MessagesInfiniteData>(queryKey, (old) =>
      prependOrReconcileOptimistic(old, message),
    );
  }

  // Invalidate DM groups list so sidebar preview updates
  if (message.directMessageGroupId) {
    queryClient.invalidateQueries({
      queryKey: directMessagesControllerFindUserDmGroupsQueryKey(),
    });
  }

  // Increment unread count — skip for own messages
  const currentUser = queryClient.getQueryData<UserControllerGetProfileResponse>(
    userControllerGetProfileQueryKey(),
  );
  if (currentUser && message.authorId === currentUser.id) {
    // Own message while detached: sending implies "take me to the present" —
    // reset the window to the live edge (refetches the newest page).
    if (detached) {
      void queryClient.resetQueries({ queryKey, exact: true });
    }
    return;
  }

  // Skip the unread bump when the user is actively viewing this exact
  // context with the tab focused — it would just be cleared moments later
  // by visible-range markAsRead, causing a badge flash. Not applied while
  // detached from the live edge (#404): the new message wasn't inserted and
  // isn't visible, so visible-range markAsRead won't fire and the bump is
  // the only signal that messages arrived.
  if (!detached && isContextViewedAndFocused(message.channelId, message.directMessageGroupId)) {
    return;
  }

  const unreadQueryKey = readReceiptsControllerGetUnreadCountsQueryKey();
  queryClient.setQueryData(unreadQueryKey, (old: UnreadCountDto[] | undefined) => {
    if (!old) return old;
    const index = old.findIndex(
      (c) => (c.channelId || c.directMessageGroupId) === contextId,
    );
    if (index >= 0) {
      const next = [...old];
      next[index] = { ...next[index], unreadCount: next[index].unreadCount + 1 };
      return next;
    }
    return [
      ...old,
      {
        channelId: message.channelId || undefined,
        directMessageGroupId: message.directMessageGroupId || undefined,
        unreadCount: 1,
        mentionCount: 0,
      },
    ];
  });
};

export const handleUpdateMessage: SocketEventHandler<typeof ServerEvents.UPDATE_MESSAGE> = async (
  { message }: UpdateMessagePayload,
  queryClient: QueryClient,
) => {
  const queryKey = messageQueryKeyForContext(message);
  if (!queryKey) return;
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<MessagesInfiniteData>(queryKey, (old) =>
    updateMessageInInfinite(old, message),
  );
};

export const handleDeleteMessage: SocketEventHandler<typeof ServerEvents.DELETE_MESSAGE> = async (
  { messageId, channelId, directMessageGroupId }: DeleteMessagePayload,
  queryClient: QueryClient,
) => {
  const queryKey = messageQueryKeyForContext({ channelId, directMessageGroupId });
  if (!queryKey) return;
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<MessagesInfiniteData>(queryKey, (old) =>
    deleteMessageFromInfinite(old, messageId),
  );

  // Remove thread replies cache if this was a thread parent.
  // Partial key (no query params) so all paginated variants are removed.
  queryClient.removeQueries({
    queryKey: [{ _id: 'threadsControllerGetReplies', path: { parentMessageId: messageId } }],
  });
};

export const handleReactionAdded: SocketEventHandler<typeof ServerEvents.REACTION_ADDED> = async (
  { messageId, reaction, channelId, directMessageGroupId, parentMessageId }: ReactionAddedPayload,
  queryClient: QueryClient,
) => {
  // Update channel/DM message cache
  const queryKey = messageQueryKeyForContext({ channelId, directMessageGroupId });
  if (queryKey) {
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData<MessagesInfiniteData>(queryKey, (old) => {
      const msg = findMessageInInfinite(old, messageId);
      if (!msg) return old;

      const updatedReactions = [...msg.reactions];
      const existingIndex = updatedReactions.findIndex((r) => r.emoji === reaction.emoji);
      if (existingIndex >= 0) {
        updatedReactions[existingIndex] = reaction;
      } else {
        updatedReactions.push(reaction);
      }

      return updateMessageInInfinite(old, {
        ...msg,
        reactions: updatedReactions,
      });
    });
  }

  // Update thread replies cache if this is a thread reply
  if (parentMessageId) {
    const threadQueryKey = threadsControllerGetRepliesQueryKey({
      path: { parentMessageId },
      query: { limit: 50, continuationToken: '' },
    });
    await queryClient.cancelQueries({ queryKey: threadQueryKey });
    queryClient.setQueryData(threadQueryKey, (old: ThreadRepliesResponseDto | undefined) => {
      if (!old) return old;
      return {
        ...old,
        replies: old.replies.map((r) => {
          if (r.id !== messageId) return r;
          const updatedReactions = [...(r.reactions || [])];
          const existingIndex = updatedReactions.findIndex((rx) => rx.emoji === reaction.emoji);
          if (existingIndex >= 0) {
            updatedReactions[existingIndex] = reaction;
          } else {
            updatedReactions.push(reaction);
          }
          return { ...r, reactions: updatedReactions };
        }),
      };
    });
  }
};

export const handleReactionRemoved: SocketEventHandler<typeof ServerEvents.REACTION_REMOVED> = async (
  { messageId, reactions, channelId, directMessageGroupId, parentMessageId }: ReactionRemovedPayload,
  queryClient: QueryClient,
) => {
  // Update channel/DM message cache
  const queryKey = messageQueryKeyForContext({ channelId, directMessageGroupId });
  if (queryKey) {
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData<MessagesInfiniteData>(queryKey, (old) => {
      const msg = findMessageInInfinite(old, messageId);
      if (!msg) return old;
      return updateMessageInInfinite(old, {
        ...msg,
        reactions,
      });
    });
  }

  // Update thread replies cache if this is a thread reply
  if (parentMessageId) {
    const threadQueryKey = threadsControllerGetRepliesQueryKey({
      path: { parentMessageId },
      query: { limit: 50, continuationToken: '' },
    });
    await queryClient.cancelQueries({ queryKey: threadQueryKey });
    queryClient.setQueryData(threadQueryKey, (old: ThreadRepliesResponseDto | undefined) => {
      if (!old) return old;
      return {
        ...old,
        replies: old.replies.map((r) => {
          if (r.id !== messageId) return r;
          return { ...r, reactions };
        }),
      };
    });
  }
};

export const handleMessagePinned: SocketEventHandler<typeof ServerEvents.MESSAGE_PINNED> = async (
  { messageId, channelId, pinnedBy, pinnedAt }: MessagePinnedPayload,
  queryClient: QueryClient,
) => {
  const queryKey = channelMessagesQueryKey(channelId);
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<MessagesInfiniteData>(queryKey, (old) => {
    const msg = findMessageInInfinite(old, messageId);
    if (!msg) return old;
    return updateMessageInInfinite(old, {
      ...msg,
      pinned: true,
      pinnedBy,
      pinnedAt,
    });
  });
  queryClient.invalidateQueries({
    queryKey: moderationControllerGetPinnedMessagesQueryKey({ path: { channelId } }),
  });
};

export const handleMessageUnpinned: SocketEventHandler<typeof ServerEvents.MESSAGE_UNPINNED> = async (
  { messageId, channelId }: MessageUnpinnedPayload,
  queryClient: QueryClient,
) => {
  const queryKey = channelMessagesQueryKey(channelId);
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<MessagesInfiniteData>(queryKey, (old) => {
    const msg = findMessageInInfinite(old, messageId);
    if (!msg) return old;
    return updateMessageInInfinite(old, {
      ...msg,
      pinned: false,
      pinnedBy: null,
      pinnedAt: null,
    });
  });
  queryClient.invalidateQueries({
    queryKey: moderationControllerGetPinnedMessagesQueryKey({ path: { channelId } }),
  });
};

export const handleThreadReplyCountUpdated: SocketEventHandler<typeof ServerEvents.THREAD_REPLY_COUNT_UPDATED> = async (
  { parentMessageId, replyCount, lastReplyAt, channelId, directMessageGroupId }: ThreadReplyCountUpdatedPayload,
  queryClient: QueryClient,
) => {
  const queryKey = messageQueryKeyForContext({ channelId, directMessageGroupId });
  if (!queryKey) return;

  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<MessagesInfiniteData>(queryKey, (old) => {
    const msg = findMessageInInfinite(old, parentMessageId);
    if (!msg) return old;
    return updateMessageInInfinite(old, {
      ...msg,
      replyCount,
      lastReplyAt,
    });
  });
};

export const handleReadReceiptUpdated: SocketEventHandler<typeof ServerEvents.READ_RECEIPT_UPDATED> = (
  payload: ReadReceiptUpdatedPayload,
  queryClient: QueryClient,
) => {
  const { channelId, directMessageGroupId, lastReadMessageId } = payload;
  const id = channelId || directMessageGroupId;
  if (!id) return;

  const currentUser = queryClient.getQueryData<UserControllerGetProfileResponse>(
    userControllerGetProfileQueryKey(),
  );

  // The backend emits this event twice for a DM read: once to the reader's
  // user room WITHOUT `userId` (self-sync — always applies to us), and once
  // to the DM room WITH `userId` (seen-by fan-out to all participants,
  // including peers). Only zero OUR unread badge when the receipt isn't a
  // peer's. If `userId` is present but we don't have our own profile cached
  // yet, skip zeroing — the self-sync copy (no userId) will still clear it.
  const isPeerReceipt = !!payload.userId && payload.userId !== currentUser?.id;

  if (!isPeerReceipt) {
    const queryKey = readReceiptsControllerGetUnreadCountsQueryKey();
    queryClient.setQueryData(queryKey, (old: UnreadCountDto[] | undefined) => {
      if (!old) return old;
      const index = old.findIndex(
        (c) => (c.channelId || c.directMessageGroupId) === id,
      );
      if (index >= 0) {
        const next = [...old];
        next[index] = {
          ...next[index],
          unreadCount: 0,
          mentionCount: 0,
          lastReadMessageId,
          lastReadAt: new Date().toISOString(),
        };
        return next;
      }
      const updated: UnreadCountDto = {
        channelId: channelId || undefined,
        directMessageGroupId: directMessageGroupId || undefined,
        unreadCount: 0,
        mentionCount: 0,
        lastReadMessageId,
        lastReadAt: new Date().toISOString(),
      };
      return [...old, updated];
    });
  }

  // Direct cache update for DM peer reads (watermark-based "seen by" real-time sync)
  if (payload.userId && payload.directMessageGroupId) {
    // Skip if this is the current user's own read receipt
    if (currentUser && payload.userId === currentUser.id) return;

    const peerReadsKey = readReceiptsControllerGetDmPeerReadsQueryKey({
      path: { directMessageGroupId: payload.directMessageGroupId },
    });

    queryClient.setQueryData(peerReadsKey, (old: DmPeerReadDto[] | undefined) => {
      const entry: DmPeerReadDto = {
        userId: payload.userId!,
        lastReadAt: payload.lastReadAt,
      };
      if (!old) return [entry];
      const index = old.findIndex((p) => p.userId === payload.userId);
      if (index >= 0) {
        const next = [...old];
        next[index] = entry;
        return next;
      }
      return [...old, entry];
    });
  }
};
