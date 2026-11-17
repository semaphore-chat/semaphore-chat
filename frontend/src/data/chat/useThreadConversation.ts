/**
 * A thread, shared by both shells: its replies (`useThreadReplies`, oldest first), loading the next page of them
 * into the same cache entry (so live replies and pages land in one list), whether the reader follows it
 * (`useThreadSubscription`), and its parent message: the one the caller already has (the channel's loaded window, the
 * old shell's clicked row) or, when none is given, the message fetched by id (a reload or a link on `?thread=`).
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  messagesControllerFindOneOptions,
  threadsControllerGetRepliesOptions,
} from '../../api-client/@tanstack/react-query.gen';
import type { ThreadRepliesResponseDto } from '../../api-client';
import { useThreadReplies } from '../../hooks/useThreadReplies';
import { useThreadSubscription } from '../../hooks/useThreadSubscription';
import type { Message } from '../../types/message.type';
import { logger } from '../../utils/logger';

/** The page size of a thread's replies (the cache key every writer uses: `socket-hub/handlers/threadHandlers`). */
export const THREAD_PAGE_SIZE = 50;

/**
 * A next page merged into the first page's entry: appended in order, without a reply the list already has (a live
 * reply that came over the socket can also be on the next page).
 */
export function mergeThreadPage(
  old: ThreadRepliesResponseDto | undefined,
  next: ThreadRepliesResponseDto,
): ThreadRepliesResponseDto {
  if (!old) return next;
  const known = new Set(old.replies.map((reply) => reply.id));
  return {
    ...old,
    replies: [...old.replies, ...(next.replies ?? []).filter((reply) => !known.has(reply.id))],
    continuationToken: next.continuationToken,
  };
}

export interface UseThreadConversationOptions {
  parentMessageId: string;
  /** The parent as the caller has it (live from a list), or null/undefined to fetch it by id. */
  parent?: Message | null;
}

export function useThreadConversation({ parentMessageId, parent }: UseThreadConversationOptions) {
  const queryClient = useQueryClient();
  const { replies, continuationToken, isLoading, error, refetch } = useThreadReplies(parentMessageId);
  const { isSubscribed, toggleSubscription } = useThreadSubscription(parentMessageId);

  const known = parent ?? null;
  const fetched = useQuery({
    ...messagesControllerFindOneOptions({ path: { id: parentMessageId } }),
    enabled: known === null && parentMessageId !== '',
    retry: false,
  });
  const parentMessage: Message | null = known ?? (fetched.data as Message | undefined) ?? null;

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMore = useCallback(async () => {
    if (!continuationToken || isLoading) return;
    setIsLoadingMore(true);
    try {
      const nextPage = await queryClient.fetchQuery(
        threadsControllerGetRepliesOptions({
          path: { parentMessageId },
          query: { limit: THREAD_PAGE_SIZE, continuationToken },
        }),
      );
      // Into the first page's entry (continuationToken: ''), which useThreadReplies and the socket handlers read.
      const baseQueryKey = threadsControllerGetRepliesOptions({
        path: { parentMessageId },
        query: { limit: THREAD_PAGE_SIZE, continuationToken: '' },
      }).queryKey;
      queryClient.setQueryData(baseQueryKey, (old: ThreadRepliesResponseDto | undefined) => mergeThreadPage(old, nextPage));
    } catch (loadError) {
      logger.error('Failed to load more thread replies:', loadError);
    } finally {
      setIsLoadingMore(false);
    }
  }, [continuationToken, isLoading, queryClient, parentMessageId]);

  return {
    /** Oldest first. */
    replies,
    continuationToken,
    isLoading,
    error,
    refetch,
    loadMore,
    isLoadingMore,
    isSubscribed,
    toggleSubscription,
    parent: parentMessage,
    /** The parent is being fetched by id. */
    parentLoading: known === null && fetched.isLoading,
    /** Fetching the parent by id failed (deleted, no access, a wrong link). */
    parentError: known === null ? fetched.error : null,
  };
}

export type ThreadConversation = ReturnType<typeof useThreadConversation>;
