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
} from '@kraken/shared';
import type { Message } from '../../types/message.type';
import type { UnreadCountDto, UserControllerGetProfileResponse } from '../../api-client';
import { messageQueryKeyForContext, channelMessagesQueryKey } from '../../utils/messageQueryKeys';
import {
  readReceiptsControllerGetUnreadCountsQueryKey,
  userControllerGetProfileQueryKey,
  moderationControllerGetPinnedMessagesQueryKey,
  directMessagesControllerFindUserDmGroupsQueryKey,
} from '../../api-client/@tanstack/react-query.gen';
import {
  prependMessageToInfinite,
  updateMessageInInfinite,
  deleteMessageFromInfinite,
  findMessageInInfinite,
} from '../../utils/messageCacheUpdaters';
import type { SocketEventHandler } from './types';
import type { ServerEvents } from '@kraken/shared';

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
};

export const handleReactionAdded: SocketEventHandler<typeof ServerEvents.REACTION_ADDED> = async (
  { messageId, reaction, channelId, directMessageGroupId }: ReactionAddedPayload,
  queryClient: QueryClient,
) => {
  const queryKey = messageQueryKeyForContext({ channelId, directMessageGroupId });
  if (!queryKey) return;

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
};

export const handleReactionRemoved: SocketEventHandler<typeof ServerEvents.REACTION_REMOVED> = async (
  { messageId, reactions, channelId, directMessageGroupId }: ReactionRemovedPayload,
  queryClient: QueryClient,
) => {
  const queryKey = messageQueryKeyForContext({ channelId, directMessageGroupId });
  if (!queryKey) return;

  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData(queryKey, (old: unknown) => {
    const msg = findMessageInInfinite(old as never, messageId);
    if (!msg) return old;
    return updateMessageInInfinite(old as never, {
      ...msg,
      reactions,
    });
  });
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
  { channelId, directMessageGroupId, lastReadMessageId }: ReadReceiptUpdatedPayload,
  queryClient: QueryClient,
) => {
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
};
