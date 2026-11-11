import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  handleNewThreadReply,
} from '../../../socket-hub/handlers/threadHandlers';
import { threadsControllerGetRepliesQueryKey } from '../../../api-client/@tanstack/react-query.gen';
import type { ThreadRepliesResponseDto } from '../../../api-client';

function getRepliesKey(parentMessageId: string) {
  return threadsControllerGetRepliesQueryKey({
    path: { parentMessageId },
    query: { limit: 50, continuationToken: '' },
  });
}

function makeReply(id: string) {
  return { id, content: `reply-${id}`, spans: [], reactions: [], attachments: [] };
}

describe('threadHandlers', () => {
  describe('handleNewThreadReply', () => {
    it('appends a reply to existing cache', async () => {
      const queryClient = new QueryClient();
      const key = getRepliesKey('parent-1');
      const existing: ThreadRepliesResponseDto = {
        replies: [makeReply('r1') as never],
        continuationToken: undefined,
      };
      queryClient.setQueryData(key, existing);

      await handleNewThreadReply(
        { reply: makeReply('r2') as never, parentMessageId: 'parent-1' },
        queryClient,
      );

      const data = queryClient.getQueryData<ThreadRepliesResponseDto>(key);
      expect(data!.replies).toHaveLength(2);
      expect(data!.replies[1].id).toBe('r2');
    });

    it('does not duplicate existing reply', async () => {
      const queryClient = new QueryClient();
      const key = getRepliesKey('parent-1');
      queryClient.setQueryData(key, {
        replies: [makeReply('r1') as never],
        continuationToken: null,
      });

      await handleNewThreadReply(
        { reply: makeReply('r1') as never, parentMessageId: 'parent-1' },
        queryClient,
      );

      const data = queryClient.getQueryData<ThreadRepliesResponseDto>(key);
      expect(data!.replies).toHaveLength(1);
    });
  });

});
