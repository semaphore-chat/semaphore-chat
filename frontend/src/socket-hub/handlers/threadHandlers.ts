import type { QueryClient } from '@tanstack/react-query';
import type {
  NewThreadReplyPayload,
  ServerEvents,
} from '@semaphore-chat/shared';
import { threadsControllerGetRepliesQueryKey } from '../../api-client/@tanstack/react-query.gen';
import type { ThreadRepliesResponseDto } from '../../api-client';
import type { SocketEventHandler } from './types';

function getRepliesQueryKey(parentMessageId: string) {
  return threadsControllerGetRepliesQueryKey({
    path: { parentMessageId },
    query: { limit: 50, continuationToken: '' },
  });
}

export const handleNewThreadReply: SocketEventHandler<typeof ServerEvents.NEW_THREAD_REPLY> = async (
  payload: NewThreadReplyPayload,
  queryClient: QueryClient,
) => {
  const queryKey = getRepliesQueryKey(payload.parentMessageId);
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData(queryKey, (old: ThreadRepliesResponseDto | undefined) => {
    if (!old) return old;
    if (old.replies.some((r) => r.id === payload.reply.id)) return old;
    return {
      ...old,
      replies: [...old.replies, payload.reply],
    };
  });
};
