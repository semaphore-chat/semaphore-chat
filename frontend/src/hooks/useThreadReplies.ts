import { useQuery } from "@tanstack/react-query";
import {
  threadsControllerGetRepliesOptions,
} from "../api-client/@tanstack/react-query.gen";
import type { Message } from "../types/message.type";

/**
 * Hook wrapping TanStack Query for thread replies.
 * Replaces manual Redux setThreadReplies/appendThreadReplies/loading management.
 */
export function useThreadReplies(parentMessageId: string) {
  const { data, isLoading, isFetched, error, refetch } = useQuery(
    threadsControllerGetRepliesOptions({
      path: { parentMessageId },
      query: { limit: 50, continuationToken: '' },
    })
  );

  return {
    replies: (data?.replies as Message[] | undefined) ?? [],
    continuationToken: data?.continuationToken,
    isLoading,
    isFetched,
    error,
    refetch,
  };
}
