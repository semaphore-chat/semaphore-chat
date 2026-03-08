import type { QueryClient } from '@tanstack/react-query';
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
import type { Message } from '../../types/message.type';
import type { UnreadCountDto, UserControllerGetProfileResponse } from '../../api-client';
import type { MessageReader } from '../../types/read-receipt.type';
import { messageQueryKeyForContext, channelMessagesQueryKey } from '../../utils/messageQueryKeys';
import {
  readReceiptsControllerGetUnreadCountsQueryKey,
  userControllerGetProfileQueryKey,
  moderationControllerGetPinnedMessagesQueryKey,
  directMessagesControllerFindUserDmGroupsQueryKey,
  threadsControllerGetRepliesQueryKey,
} from '../../api-client/@tanstack/react-query.gen';
import type { ThreadRepliesResponseDto, EnrichedThreadReplyDto } from '../../api-client';
import {
  prependMessageToInfinite,
  updateMessageInInfinite,
  deleteMessageFromInfinite,
  findMessageInInfinite,
} from '../../utils/messageCacheUpdaters';
import type { SocketEventHandler } from './types';
import type { ServerEvents } from '@semaphore-chat/shared';

export const handleNewMessage: SocketEventHandler<typeof ServerEvents.NEW_MESSAGE> = async (
  { message }: NewMessagePayload,
  queryClient: QueryClient,
) => {
  const queryKey = messageQueryKeyForContext(message);
  if (!queryKey) return;
  const contextId = message.channelId || message.directMessageGroupId;
  if (!contextId) return;

  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData(queryKey, (old: unknown) =>
    prependMessageToInfinite(old as never, message as Message),
  );

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
  if (currentUser && message.authorId === currentUser.id) return;

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
  queryClient.setQueryData(queryKey, (old: unknown) =>
    updateMessageInInfinite(old as never, message as Message),
  );
};

export const handleDeleteMessage: SocketEventHandler<typeof ServerEvents.DELETE_MESSAGE> = async (
  { messageId, channelId, directMessageGroupId }: DeleteMessagePayload,
  queryClient: QueryClient,
) => {
  const queryKey = messageQueryKeyForContext({ channelId, directMessageGroupId });
  if (!queryKey) return;
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData(queryKey, (old: unknown) =>
    deleteMessageFromInfinite(old as never, messageId),
  );

  // Remove thread replies cache if this was a thread parent
  const threadQueryKey = threadsControllerGetRepliesQueryKey({
    path: { parentMessageId: messageId },
  });
  queryClient.removeQueries({ queryKey: threadQueryKey });
};

export const handleReactionAdded: SocketEventHandler<typeof ServerEvents.REACTION_ADDED> = async (
  { messageId, reaction, channelId, directMessageGroupId, parentMessageId }: ReactionAddedPayload,
  queryClient: QueryClient,
) => {
  // Update channel/DM message cache
  const queryKey = messageQueryKeyForContext({ channelId, directMessageGroupId });
  if (queryKey) {
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData(queryKey, (old: unknown) => {
      const msg = findMessageInInfinite(old as never, messageId);
      if (!msg) return old;

      const updatedReactions = [...msg.reactions];
      const existingIndex = updatedReactions.findIndex((r) => r.emoji === reaction.emoji);
      if (existingIndex >= 0) {
        updatedReactions[existingIndex] = reaction;
      } else {
        updatedReactions.push(reaction);
      }

      return updateMessageInInfinite(old as never, {
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
          return { ...r, reactions: updatedReactions } as EnrichedThreadReplyDto;
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
    queryClient.setQueryData(queryKey, (old: unknown) => {
      const msg = findMessageInInfinite(old as never, messageId);
      if (!msg) return old;
      return updateMessageInInfinite(old as never, {
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
          return { ...r, reactions } as EnrichedThreadReplyDto;
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
  queryClient.setQueryData(queryKey, (old: unknown) => {
    const msg = findMessageInInfinite(old as never, messageId);
    if (!msg) return old;
    return updateMessageInInfinite(old as never, {
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
  queryClient.setQueryData(queryKey, (old: unknown) => {
    const msg = findMessageInInfinite(old as never, messageId);
    if (!msg) return old;
    return updateMessageInInfinite(old as never, {
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
  queryClient.setQueryData(queryKey, (old: unknown) => {
    const msg = findMessageInInfinite(old as never, parentMessageId);
    if (!msg) return old;
    return updateMessageInInfinite(old as never, {
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
  const queryKey = readReceiptsControllerGetUnreadCountsQueryKey();
  queryClient.setQueryData(queryKey, (old: UnreadCountDto[] | undefined) => {
    if (!old) return old;
    const updated: UnreadCountDto = {
      channelId: channelId || undefined,
      directMessageGroupId: directMessageGroupId || undefined,
      unreadCount: 0,
      mentionCount: 0,
      lastReadMessageId,
      lastReadAt: new Date().toISOString(),
    };
    const index = old.findIndex(
      (c) => (c.channelId || c.directMessageGroupId) === id,
    );
    if (index >= 0) {
      const next = [...old];
      next[index] = updated;
      return next;
    }
    return [...old, updated];
  });

  // Direct cache update for message readers (DM "seen by" real-time sync)
  if (payload.userId && payload.username) {
    // Skip if this is the current user's own read receipt
    const currentUser = queryClient.getQueryData<UserControllerGetProfileResponse>(
      userControllerGetProfileQueryKey(),
    );
    if (currentUser && payload.userId === currentUser.id) return;

    const newReader: MessageReader = {
      userId: payload.userId,
      username: payload.username,
      displayName: payload.displayName ?? undefined,
      avatarUrl: payload.avatarUrl ?? undefined,
      readAt: new Date(payload.lastReadAt),
    };

    // Update all cached message readers queries for messages <= lastReadMessageId
    const queries = queryClient.getQueriesData<MessageReader[]>({
      queryKey: [{ _id: 'readReceiptsControllerGetMessageReaders' }],
    });

    for (const [cachedKey, cachedData] of queries) {
      if (!cachedData) continue;
      // Extract messageId and context from the query key options
      const keyObj = cachedKey[0] as {
        path?: { messageId?: string };
        query?: { channelId?: string; directMessageGroupId?: string };
      };
      const msgId = keyObj.path?.messageId;
      if (!msgId) continue;
      // Only update queries for the same conversation context
      const keyContextId = keyObj.query?.directMessageGroupId || keyObj.query?.channelId;
      if (keyContextId !== id) continue;
      // Skip if this user is already in the readers list
      if (cachedData.some((r) => r.userId === payload.userId)) continue;
      queryClient.setQueryData(cachedKey, [...cachedData, newReader]);
    }
  }
};
