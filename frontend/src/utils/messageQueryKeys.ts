import {
  messagesControllerFindAllForChannelQueryKey,
  messagesControllerFindAllForGroupQueryKey,
  messagesControllerFindAroundForChannelQueryKey,
  messagesControllerFindAroundForGroupQueryKey,
} from '../api-client/@tanstack/react-query.gen';

// WebSocket events keep message data fresh — disable TanStack Query
// background refetch. Re-fetch only on socket reconnect (invalidateQueries).
export const MESSAGE_STALE_TIME = Infinity;

/** Max pages kept in memory for infinite queries (25 msgs/page × 40 = 1000 msgs) */
export const MESSAGE_MAX_PAGES = 40;

export function channelMessagesQueryKey(channelId: string) {
  return messagesControllerFindAllForChannelQueryKey({
    path: { channelId },
    query: { limit: 25, continuationToken: '' },
  });
}

export function dmMessagesQueryKey(dmGroupId: string) {
  return messagesControllerFindAllForGroupQueryKey({
    path: { groupId: dmGroupId },
    query: { limit: 25, continuationToken: '' },
  });
}

export function channelAnchoredMessagesQueryKey(channelId: string, anchorMessageId: string) {
  return messagesControllerFindAroundForChannelQueryKey({
    path: { channelId, messageId: anchorMessageId },
    query: { limit: 50 },
  });
}

export function dmAnchoredMessagesQueryKey(dmGroupId: string, anchorMessageId: string) {
  return messagesControllerFindAroundForGroupQueryKey({
    path: { groupId: dmGroupId, messageId: anchorMessageId },
    query: { limit: 50 },
  });
}

/**
 * Returns the correct query key for a message based on its context.
 * Used by WebSocket handlers that receive messages and need to update the right cache.
 */
export function messageQueryKeyForContext(message: { channelId?: string | null; directMessageGroupId?: string | null }) {
  if (message.channelId) return channelMessagesQueryKey(message.channelId);
  if (message.directMessageGroupId) return dmMessagesQueryKey(message.directMessageGroupId);
  return undefined;
}
